// Records someone already keeps, played back through the app before anyone uses it: a template and the rows a
// person would paste into it (`template.md` and `rows.tsv` — the first row naming the columns, one column the day
// each record was made) in the directory `LOWLINE_REPLAY` names. The rows are brought in the way the app brings
// them in; the first `LOWLINE_REPLAY_BROUGHT_IN_WEEKS` weeks of them all at the start, as a person who imports
// their history would, the rest one by one on the day they were made. The sidecar is asked about each later
// record field by field and the record saved with what it says (`ReplayTests.cs`); what was offered becomes the
// events a save records, and those the weekly counts a person would hand over. Everything is written to
// `LOWLINE_REPLAY_OUT` (default: a folder in the temp directory) — the rows never leave this machine, only what
// the counts say. Runs only when `LOWLINE_REPLAY` is set; needs `dotnet`.
import { describe, expect, it } from 'vitest'
import { documentFileName, documentTitle, newDocument, type FieldValues } from '../documents.js'
import { presentation, suggestionEvents, type Offer, type Presentation, type SuggestionEvent } from '../events.js'
import { importFields, planImport } from '../import.js'
import { documentSnapshot, templateSnapshot, type DocumentSnapshot, type Suggestion } from '../projection.js'
import { weekOf, weeklyCounts } from '../weekly-counts.js'

interface NodeProcess {
  env: Record<string, string | undefined>
  getBuiltinModule(name: 'node:fs'): {
    readFileSync(path: string, encoding: 'utf8'): string
    writeFileSync(path: string, text: string): void
    mkdirSync(path: string, options: { recursive: true }): void
  }
  getBuiltinModule(name: 'node:child_process'): {
    execFileSync(file: string, args: string[], options: { env: Record<string, string | undefined>; stdio: 'inherit'; timeout: number }): void
  }
}
const process = (globalThis as { process?: NodeProcess }).process
const env = process?.env ?? {}

/** One line the sidecar's side writes: what was offered for a field, and the fields filled when it was asked. */
interface Offered {
  doc: string
  field: string
  suggestion: Suggestion
  filled: string[]
  /** What had been typed when it was shown; null before typing. */
  typed: string | null
}

const DAY = 24 * 60 * 60 * 1000

describe.runIf(env.LOWLINE_REPLAY)('records played back through the app', () => {
  it('brings them in, offers what it would, and counts what was done with it by the week', { timeout: 60 * 60_000 }, () => {
    const fs = process!.getBuiltinModule('node:fs')
    const { execFileSync } = process!.getBuiltinModule('node:child_process')
    const source = env.LOWLINE_REPLAY!
    const out = env.LOWLINE_REPLAY_OUT ?? `${env.TEMP ?? env.TMPDIR ?? '.'}/lowline-replay`
    const broughtInWeeks = Number(env.LOWLINE_REPLAY_BROUGHT_IN_WEEKS ?? 0)
    fs.mkdirSync(out, { recursive: true })

    // Brought in as the app brings in pasted rows.
    const templateSource = fs.readFileSync(`${source}/template.md`, 'utf8')
    const template = templateSnapshot(templateSource)
    const rows = fs
      .readFileSync(`${source}/rows.tsv`, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => line.split('\t'))
    const plan = planImport(rows, importFields(templateSource))
    expect(plan.problems, 'every row fits the form').toEqual([])
    expect(plan.documents.length).toBe(rows.length - 1)
    expect(plan.documents.every((r) => r.date), 'every record has its day').toBe(true)

    // Made in office hours on its day, half an hour apart; the history brought in all at once, just before the rest.
    const perDay = new Map<number, number>()
    const made = plan.documents.map((r) => {
      const day = r.date!.getTime()
      const nth = perDay.get(day) ?? 0
      perDay.set(day, nth + 1)
      return day + 9 * 60 * 60 * 1000 + nth * 30 * 60 * 1000
    })
    const firstWeek = Date.parse(weekOf(made[0]))
    const broughtIn = made.filter((at) => at < firstWeek + broughtInWeeks * 7 * DAY).length
    const importedAt = (made[broughtIn] ?? made[made.length - 1]) - 60 * 60 * 1000
    // Named as the app names them — by the record's day and its first value, numbered when the name is taken.
    const taken = new Set<string>()
    const documents: DocumentSnapshot[] = plan.documents.map((record, i) => {
      const id = `replay-${i}`
      let name = documentFileName(record.date!, documentTitle(templateSource, record.values))
      for (let n = 1; taken.has(name); n++) name = name.replace(/( \(\d+\))?\.md$/, ` (${n}).md`)
      taken.add(name)
      return documentSnapshot(`문서/${name}`, newDocument(templateSource, record.values, id), i < broughtIn ? importedAt + i : made[i])!
    })
    const snapshot = `${out}/snapshot.json`
    fs.writeFileSync(snapshot, JSON.stringify({ templates: [template], documents, broughtIn }))

    // Asked and saved one by one, on the sidecar's side.
    const offersFile = `${out}/offers.jsonl`
    fs.writeFileSync(`${out}/measurement.txt`, '')
    execFileSync('dotnet', ['test', '--project', 'src-host/Lowline.Host.Tests', '--', '--filter-method', '*Replays_records_in_the_order_they_were_made'], {
      env: { ...env, LOWLINE_REPLAY_SNAPSHOT: snapshot, LOWLINE_REPLAY_OFFERS: offersFile, LOWLINE_PERF_OUT: `${out}/measurement.txt` },
      stdio: 'inherit',
      timeout: 60 * 60_000,
    })
    const offered: Offered[] = fs
      .readFileSync(offersFile, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
    const before = offered.filter((o) => o.typed === null)
    expect(before.length, 'every judgment field of every later record asked').toBe((documents.length - broughtIn) * template.suggest.length)

    // Each save records what became of what it was offered: taken when it was the value, changed otherwise.
    const byDoc = new Map<string, Offered[]>()
    for (const o of offered) byDoc.set(o.doc, [...(byDoc.get(o.doc) ?? []), o])
    const events: SuggestionEvent[] = []
    const shown: Presentation[] = []
    documents.forEach((document, i) => {
      if (i < broughtIn) return
      const at = new Date(made[i])
      const offers = new Map<string, Offer>()
      for (const o of byDoc.get(document.id) ?? []) {
        if (o.suggestion.value === null) continue
        const offer: Offer = { suggestion: o.suggestion, shown: at, filled: o.filled, decided: at }
        offers.set(o.field, offer)
        shown.push(presentation(document.template, o.field, offer))
      }
      events.push(...suggestionEvents(offers, new Set(), document.values as FieldValues, document.id, at, document.template))
    })
    fs.writeFileSync(`${out}/events.jsonl`, events.map((e) => JSON.stringify(e)).join('\n') + '\n')

    const counts = weeklyCounts([template], documents, events, shown)
    const text = JSON.stringify(counts, null, 2)
    fs.writeFileSync(`${out}/weekly-counts.json`, text + '\n')

    // Every suggestion shown is counted once, as shown and as decided.
    const decided = counts.counts.reduce((n, c) => n + c.accepted + c.corrected + c.rejected, 0)
    const presented = counts.counts.reduce((n, c) => n + c.presented, 0)
    expect(decided).toBe(events.length)
    expect(presented).toBe(shown.length)
    expect(counts.counts.reduce((n, c) => n + Object.values(c.bySource).reduce((m, s) => m + s.decided, 0), 0)).toBe(decided)

    // Nothing that says what the records are about: no form or field name, no value.
    const values = new Set(documents.flatMap((d) => Object.values(d.values).map(String)).filter((v) => v.length >= 2))
    for (const secret of [template.ref.split('@')[0], ...template.fields.map((f) => f.name), ...values])
      expect(text.includes(secret), `${secret} in the counts`).toBe(false)

    // The form's records a week are counted by the weeks they were made in — those brought in all at once too.
    const used = documents.length - broughtIn
    const weeks = Math.round((Date.parse(weekOf(made[made.length - 1])) - Date.parse(weekOf(made[0]))) / (7 * DAY)) + 1
    const form = counts.forms[0]
    console.log(
      `replay · ${broughtIn} brought in · ${used} made · ${documents.length} over ${weeks} weeks (${(documents.length / weeks).toFixed(2)}/week)` +
        ` · counted: ${form.confirmed} confirmed over ${form.weeks} weeks (${form.perWeek}/week) · ${events.length} decided of ${before.length} asked · ${shown.length} shown`,
    )
    for (const field of template.suggest) {
      const quarters = new Map<number, { right: number; wrong: number; asked: number }>()
      for (const o of before.filter((o) => o.field === field)) {
        const i = Number(o.doc.slice('replay-'.length))
        const quarter = Math.floor((Date.parse(weekOf(made[i])) - Date.parse(weekOf(made[broughtIn]))) / (13 * 7 * DAY))
        const q = quarters.get(quarter) ?? { right: 0, wrong: 0, asked: 0 }
        q.asked++
        if (o.suggestion.value !== null) {
          if (o.suggestion.value === String(documents[i].values[field])) q.right++
          else q.wrong++
        }
        quarters.set(quarter, q)
      }
      console.log(
        `  ${field}: ` +
          [...quarters.entries()]
            .map(([q, { right, wrong, asked }]) => `q${q + 1} offered ${right + wrong}/${asked}, right ${right + wrong ? Math.round((100 * right) / (right + wrong)) : 0}%`)
            .join(' · ') +
          // Taken while typing: the value shown last as it was typed was the one saved.
          (offered.some((o) => o.field === field && o.typed !== null)
            ? ` · while typing: shown ${offered.filter((o) => o.field === field && o.typed !== null).length}, taken ${
                events.filter((e) => e.field === field && e.kind === 'accept').length -
                before.filter((o) => o.field === field && o.suggestion.value !== null && o.suggestion.value === String(documents[Number(o.doc.slice('replay-'.length))].values[field])).length
              }`
            : ''),
      )
    }
    expect(form).toEqual({ form: 1, confirmed: documents.length, weeks, perWeek: Math.round((documents.length / weeks) * 100) / 100 })
  })
})
