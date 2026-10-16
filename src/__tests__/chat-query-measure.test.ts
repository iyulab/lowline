// What a model on this computer made of questions asked of businesses whose inspections refer to them, judged as the app
// reads replies: each reply's plan against the plan of the reply meant. The replies come from the sidecar's side
// (`ChatQueryMeasureTests.cs`), written to the file `LOWLINE_CHAT_MEASURE` names. A measurement: it says how many plans
// were as meant and fails only when the file cannot be read. Runs only when `LOWLINE_CHAT_MEASURE` is set.
import { describe, expect, it } from 'vitest'
import { queryPlan, type ReadPlan, type ReferringCount } from '../chat-query.js'
import { templateSnapshot, type TemplateField } from '../projection.js'

interface NodeProcess {
  env: Record<string, string | undefined>
  getBuiltinModule(name: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string }
}
const process = (globalThis as { process?: NodeProcess }).process
const env = process?.env ?? {}

interface Column {
  name: string
  type: string
  options?: string[] | null
}

/**
 * A plan as the count it makes, so two plans that answer alike compare equal: its conditions in one order, and not
 * counted by a field it keeps one value of (that makes one row, the same number). A question not counted is one,
 * whatever the reason given.
 */
const sorted = (read: ReadPlan) =>
  'plan' in read
    ? {
        ...read.plan,
        groupBy: read.plan.groupBy.filter((g) => !read.plan.filters.some((f) => f.column === g && f.op === 'equal')),
        filters: [...read.plan.filters].sort((a, b) => `${a.column}${a.op}${a.value}`.localeCompare(`${b.column}${b.op}${b.value}`)),
      }
    : 'unanswerable' in read
      ? { unanswerable: true }
      : read

describe.runIf(env.LOWLINE_CHAT_MEASURE)('replies a model on this computer made to questions of referred documents', () => {
  it('count what was asked, as often as they do', () => {
    const [head, ...lines] = process!.getBuiltinModule('node:fs').readFileSync(env.LOWLINE_CHAT_MEASURE!, 'utf8').split(/\r?\n/).filter(Boolean)
    const { model, template, referring } = JSON.parse(head) as { model: string; template: string; referring: { name: string; via: string[]; columns: Column[] }[] }
    const fields = templateSnapshot(template).fields
    const asField = (c: Column): TemplateField => ({ name: c.name, label: c.name, type: c.type, multiple: false, options: c.options ?? [] })
    const counts: ReferringCount[] = referring.map((r) => ({ ref: r.name, name: r.name, via: r.via, columns: r.columns.map(asField) }))
    const today = new Date(2026, 9, 16)
    let meant = 0
    for (const line of lines) {
      const { question, meant: wanted, reply, ms } = JSON.parse(line) as { question: string; meant: string; reply: string; ms: number }
      const read = queryPlan(reply, fields, today, undefined, counts)
      const right = JSON.stringify(sorted(read)) === JSON.stringify(sorted(queryPlan(wanted, fields, today, undefined, counts)))
      if (right) meant++
      console.log(`${model} · ${right ? 'meant' : 'not meant'} · ${ms} ms · ${question} → ${JSON.stringify(read)}`)
    }
    console.log(`${model} · ${meant}/${lines.length} plans as meant`)
    expect(lines.length).toBeGreaterThan(0)
  })
})
