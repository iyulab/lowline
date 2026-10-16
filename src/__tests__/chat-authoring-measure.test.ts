// What a model on this computer made of requests for templates, judged as the app reads drafts: the draft the reply
// holds, tidied as the chat tidies it, whether it works as a template, whether it has the fields asked for, and whether
// the ones asked to be judged are judgment fields with a closed list. The replies come from the sidecar's side
// (`ChatAuthoringMeasureTests.cs`), written to the file `LOWLINE_CHAT_AUTHORING_MEASURE` names. A measurement: it fails
// only when the file cannot be read or was made from a template other than the one a new template starts as.
import { describe, expect, it } from 'vitest'
import { parseFormdown } from '@formdown/core'
import { draftOf, draftProblems, tidyDraft } from '../chat-authoring.js'
import { templateSnapshot, type TemplateSnapshot } from '../projection.js'
import { starterTemplate } from '../strings.js'

interface NodeProcess {
  env: Record<string, string | undefined>
  getBuiltinModule(name: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string }
}
const process = (globalThis as { process?: NodeProcess }).process
const env = process?.env ?? {}

/** A name as compared with a word asked for: spaces and underscores aside. */
const plain = (name: string) => name.replace(/[\s_]+/g, '')

describe.runIf(env.LOWLINE_CHAT_AUTHORING_MEASURE)('drafts a model on this computer made of templates asked for', () => {
  it('work as templates, with the fields asked for and the judgments closed', () => {
    const [head, ...lines] = process!.getBuiltinModule('node:fs').readFileSync(env.LOWLINE_CHAT_AUTHORING_MEASURE!, 'utf8').split(/\r?\n/).filter(Boolean)
    const { model, template } = JSON.parse(head) as { model: string; template: string }
    expect(template, 'the request starts from the template a new one starts as').toBe(starterTemplate('new-template'))
    const tally = { works: 0, fields: 0, asked: 0, judged: 0, judgedAsked: 0, conditional: 0, conditionalAsked: 0 }
    for (const line of lines) {
      const { id, fields, judged, conditional = [], reply, ms } = JSON.parse(line) as {
        id: string
        fields: string[]
        judged: string[]
        conditional?: string[]
        reply: string
        ms: number
      }
      const draft = draftOf(reply)
      const tidied = draft === null ? null : tidyDraft(draft)
      const problems = tidied === null ? ['no template in the reply'] : draftProblems(tidied)
      let snapshot: TemplateSnapshot | null = null
      if (tidied !== null && problems.length === 0) snapshot = templateSnapshot(tidied)
      const names = snapshot?.fields.map((f) => plain(f.name)) ?? []
      const has = (word: string) => names.some((n) => n.includes(plain(word)))
      const closedJudged = (word: string) =>
        snapshot?.fields.some((f) => plain(f.name).includes(plain(word)) && snapshot!.suggest.includes(f.name) && f.options.length > 0) ?? false
      // A field asked to apply only on another's answer: shown, hidden, enabled or required by a condition.
      const conditioned = snapshot ? parseFormdown(tidied!).forms.filter((f) => f.conditions && Object.keys(f.conditions).length > 0).map((f) => plain(f.name)) : []
      const onCondition = conditional.filter((word) => conditioned.some((n) => n.includes(plain(word))))
      const found = fields.filter(has)
      const closed = judged.filter(closedJudged)
      if (snapshot) tally.works++
      tally.fields += found.length
      tally.asked += fields.length
      tally.judged += closed.length
      tally.judgedAsked += judged.length
      tally.conditional += onCondition.length
      tally.conditionalAsked += conditional.length
      console.log(
        `${model} · ${id} · ${ms} ms · ${snapshot ? 'works' : `does not work: ${problems.join(' / ')}`} · fields ${found.length}/${fields.length}` +
          (found.length < fields.length ? ` (missing ${fields.filter((w) => !has(w)).join(', ')})` : '') +
          ` · judged ${closed.length}/${judged.length}` +
          (conditional.length ? ` · on a condition ${onCondition.length}/${conditional.length}` : '') +
          ` · ${snapshot?.fields.map((f) => `${f.name}:${f.type}`).join(' ') ?? ''}`,
      )
    }
    console.log(
      `${model} · works ${tally.works}/${lines.length} · fields ${tally.fields}/${tally.asked} · judged and closed ${tally.judged}/${tally.judgedAsked} · on a condition ${tally.conditional}/${tally.conditionalAsked}`,
    )
    expect(lines.length).toBeGreaterThan(0)
  })
})
