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
import { charactersTyped, presentation, suggestionEvents, type Offer, type Presentation, type SuggestionEvent } from '../events.js'
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
  /** The precision the field's replay promised for it; null when nothing was offered or nothing was promised. */
  promised: number | null
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
      // A class taken leaves the field open for the rest of the value: what the save says about it is kept apart, as the app keeps it.
      const classes = new Map<string, Offer>()
      for (const o of byDoc.get(document.id) ?? []) {
        if (o.suggestion.value === null) continue
        // Taken or changed the moment it showed, at what had been typed: a replay has no person to take time over it.
        const typed = charactersTyped(o.typed ?? undefined)
        const offer: Offer = { suggestion: o.suggestion, shown: at, filled: o.filled, typed, decided: at, decidedTyped: typed }
        ;(o.suggestion.mode === 'coarse' ? classes : offers).set(o.field, offer)
        shown.push(presentation(document.template, o.field, offer))
      }
      for (const kept of [classes, offers])
        events.push(...suggestionEvents(kept, new Set(), document.values as FieldValues, document.id, at, document.template))
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
    // Every decision and presentation here was recorded with what had been typed, so each falls in one slot.
    expect(counts.counts.reduce((n, c) => n + Object.values(c.byTyped).reduce((m, s) => m + s.decided, 0), 0)).toBe(decided)
    expect(counts.counts.reduce((n, c) => n + Object.values(c.byTyped).reduce((m, s) => m + s.presented, 0), 0)).toBe(presented)
    // Each says when it was shown and decided, so each has a time — none at all, here.
    const timed = counts.counts.flatMap((c) => Object.values(c.byTyped).flatMap((s) => (s.dwell ? [...s.dwell.accepted, ...s.dwell.other] : [])))
    expect(timed.reduce((n, k) => n + k, 0)).toBe(decided)

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
    // Quarter by quarter, for each field: how often a value was offered before typing and while typing, how often it
    // was the one saved, and what its replay promised when it was offered — what the app shows under the field's curve.
    const tally = () => ({ asked: 0, offered: 0, right: 0, promised: 0, promises: 0 })
    const summary: Record<string, Record<string, { before: ReturnType<typeof tally>; typing: ReturnType<typeof tally>; class: ReturnType<typeof tally> }>> = {}
    const start = Date.parse(weekOf(made[broughtIn]))
    for (const o of offered) {
      const i = Number(o.doc.slice('replay-'.length))
      const quarter = `q${Math.floor((Date.parse(weekOf(made[i])) - start) / (13 * 7 * DAY)) + 1}`
      const cells = ((summary[o.field] ??= {})[quarter] ??= { before: tally(), typing: tally(), class: tally() })
      if (o.typed === null) cells.before.asked++
      if (o.suggestion.value === null) continue
      // A class is offered where the value is not: it is counted apart, against the asks before typing.
      const cell = o.suggestion.mode === 'coarse' ? cells.class : cells[o.typed === null ? 'before' : 'typing']
      cell.offered++
      const saved = String(documents[i].values[o.field])
      if (o.suggestion.mode === 'coarse' ? saved.startsWith(o.suggestion.value) : o.suggestion.value === saved) cell.right++
      if (o.promised !== null) {
        cell.promised += o.promised
        cell.promises++
      }
    }
    fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2) + '\n')
    const read = (t: ReturnType<typeof tally>) =>
      `${t.offered}${t.asked ? `/${t.asked}` : ''} right ${t.offered ? Math.round((100 * t.right) / t.offered) : 0}%` +
      (t.promises ? ` (promised ${Math.round((100 * t.promised) / t.promises)}%)` : '')
    for (const field of template.suggest) {
      const quarters = Object.entries(summary[field] ?? {})
      console.log(`  ${field}: ` + quarters.map(([q, { before }]) => `${q} ${read(before)}`).join(' · '))
      if (quarters.some(([, { typing }]) => typing.offered > 0))
        console.log(`  ${field} while typing: ` + quarters.map(([q, { typing }]) => `${q} ${read(typing)}`).join(' · '))
      if (quarters.some(([, c]) => c.class.offered > 0))
        console.log(`  ${field} class: ` + quarters.map(([q, c]) => `${q} ${read(c.class)}`).join(' · '))
    }
    expect(form).toEqual({ form: 1, confirmed: documents.length, outside: 0, weeks, perWeek: Math.round((documents.length / weeks) * 100) / 100 })
  })
})
