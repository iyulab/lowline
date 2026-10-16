// What a model on this computer made of requests for templates, judged as the app reads drafts: the draft the reply
// holds, tidied as the chat tidies it, whether it works as a template, whether it has the fields asked for, whether the
// ones asked to be judged are judgment fields with a closed list, and whether the ones asked to apply only on another's
// answer have a condition. The replies come from the sidecar's side (`ChatAuthoringMeasureTests.cs`), written to the
// file `LOWLINE_CHAT_AUTHORING_MEASURE` names.
//
// The chat asks once more when a draft has problems, saying what they are (`chat-panel.ts`). With
// `LOWLINE_CHAT_AUTHORING_RETRIES_OUT` this writes that message for each draft with problems, for the sidecar's side to
// ask the second time; with `LOWLINE_CHAT_AUTHORING_SECOND` naming the replies it got, a draft the second reply holds
// takes the first one's place, as in the chat, and the result is what a person is shown.
//
// A measurement: it fails only when a file cannot be read or was made from a template other than the one a new
// template starts as.
import { describe, expect, it } from 'vitest'
import { parseFormdown } from '@formdown/core'
import { draftOf, draftProblems, retryMessage, tidyDraft } from '../chat-authoring.js'
import { templateSnapshot, type TemplateSnapshot } from '../projection.js'
import { starterTemplate } from '../strings.js'

interface NodeProcess {
  env: Record<string, string | undefined>
  getBuiltinModule(name: 'node:fs'): {
    readFileSync(path: string, encoding: 'utf8'): string
    writeFileSync(path: string, text: string): void
  }
}
const process = (globalThis as { process?: NodeProcess }).process
const env = process?.env ?? {}

/** A name as compared with a word asked for: spaces and underscores aside. */
const plain = (name: string) => name.replace(/[\s_]+/g, '')

interface Asked {
  id: string
  ask: string
  fields: string[]
  judged: string[]
  conditional?: string[]
  reply: string
  ms: number
}

/** How one reply reads as a draft, against what its request asked for. */
function judge(asked: Asked, reply: string) {
  const draft = draftOf(reply)
  const tidied = draft === null ? null : tidyDraft(draft)
  const problems = tidied === null ? [] : draftProblems(tidied)
  const snapshot: TemplateSnapshot | null = tidied !== null && problems.length === 0 ? templateSnapshot(tidied) : null
  const names = snapshot?.fields.map((f) => plain(f.name)) ?? []
  const has = (word: string) => names.some((n) => n.includes(plain(word)))
  const closedJudged = (word: string) =>
    snapshot?.fields.some((f) => plain(f.name).includes(plain(word)) && snapshot.suggest.includes(f.name) && f.options.length > 0) ?? false
  // A field asked to apply only on another's answer: shown, hidden, enabled or required by a condition.
  const conditioned = snapshot ? parseFormdown(tidied!).forms.filter((f) => f.conditions && Object.keys(f.conditions).length > 0).map((f) => plain(f.name)) : []
  const conditional = asked.conditional ?? []
  return {
    draft,
    problems,
    snapshot,
    found: asked.fields.filter(has),
    missing: asked.fields.filter((w) => !has(w)),
    closed: asked.judged.filter(closedJudged),
    onCondition: conditional.filter((word) => conditioned.some((n) => n.includes(plain(word)))),
  }
}

type Judged = ReturnType<typeof judge>

function report(model: string, title: string, rows: [Asked, Judged, number][]) {
  const total = { works: 0, fields: 0, asked: 0, judged: 0, judgedAsked: 0, conditional: 0, conditionalAsked: 0 }
  for (const [asked, judged, ms] of rows) {
    const { snapshot, problems, found, missing, closed, onCondition } = judged
    const conditional = asked.conditional ?? []
    if (snapshot) total.works++
    total.fields += found.length
    total.asked += asked.fields.length
    total.judged += closed.length
    total.judgedAsked += asked.judged.length
    total.conditional += onCondition.length
    total.conditionalAsked += conditional.length
    const state = snapshot ? 'works' : judged.draft === null ? 'does not work: no template in the reply' : `does not work: ${problems.join(' / ')}`
    console.log(
      `${model} · ${title} · ${asked.id} · ${ms} ms · ${state} · fields ${found.length}/${asked.fields.length}` +
        (missing.length ? ` (missing ${missing.join(', ')})` : '') +
        ` · judged ${closed.length}/${asked.judged.length}` +
        (conditional.length ? ` · on a condition ${onCondition.length}/${conditional.length}` : '') +
        ` · ${snapshot?.fields.map((f) => `${f.name}:${f.type}`).join(' ') ?? ''}`,
    )
  }
  console.log(
    `${model} · ${title} · works ${total.works}/${rows.length} · fields ${total.fields}/${total.asked} · judged and closed ${total.judged}/${total.judgedAsked} · on a condition ${total.conditional}/${total.conditionalAsked}`,
  )
}

describe.runIf(env.LOWLINE_CHAT_AUTHORING_MEASURE)('drafts a model on this computer made of templates asked for', () => {
  it('work as templates, with the fields asked for, the judgments closed and the conditions written', () => {
    const fs = process!.getBuiltinModule('node:fs')
    const [head, ...lines] = fs.readFileSync(env.LOWLINE_CHAT_AUTHORING_MEASURE!, 'utf8').split(/\r?\n/).filter(Boolean)
    const { model, template } = JSON.parse(head) as { model: string; template: string }
    expect(template, 'the request starts from the template a new one starts as').toBe(starterTemplate('new-template'))
    const asked = lines.map((line) => JSON.parse(line) as Asked)
    const first = asked.map((a) => [a, judge(a, a.reply), a.ms] as [Asked, Judged, number])
    report(model, 'first draft', first)

    // What the chat would say back: only a draft that has problems is asked for again.
    if (env.LOWLINE_CHAT_AUTHORING_RETRIES_OUT) {
      const retries = first
        .filter(([, j]) => j.draft !== null && j.problems.length > 0)
        .map(([a, j]) => JSON.stringify({ id: a.id, ask: a.ask, first: a.reply, retry: retryMessage(j.problems) }))
      fs.writeFileSync(env.LOWLINE_CHAT_AUTHORING_RETRIES_OUT, retries.join('\n') + (retries.length ? '\n' : ''))
      console.log(`${model} · ${retries.length} drafts to ask for again`)
    }

    // What a person is shown: the second reply's draft, where there is one, in place of the first.
    if (env.LOWLINE_CHAT_AUTHORING_SECOND) {
      const second = new Map(
        fs
          .readFileSync(env.LOWLINE_CHAT_AUTHORING_SECOND, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { id: string; reply: string; ms: number })
          .map((s) => [s.id, s] as const),
      )
      const shown = first.map(([a, j, ms]): [Asked, Judged, number] => {
        const again = second.get(a.id)
        if (!again || draftOf(again.reply) === null) return [a, j, ms]
        return [a, judge(a, again.reply), ms + again.ms]
      })
      report(model, 'after the chat asks once more', shown)
    }
    expect(lines.length).toBeGreaterThan(0)
  })
})
