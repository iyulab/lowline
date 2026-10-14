import { describe, expect, it } from 'vitest'
import { queryPlan } from '../chat-query.ts'
import { templateSnapshot } from '../projection.ts'

const fence = '```'
const fields = templateSnapshot(`---
id: visit
version: 1
---
@원인: [select options="부품,설정,사용자"]
@방문일(방문한 날): [date]
@지역: [text]
`).fields

describe('what a reply asks to count', () => {
  it('is the plan in its last block, checked against the template: fields by name or label, conditions the vault asks', () => {
    const reply = `${fence}json\n{"groupBy": ["원인"], "filters": [{"field": "방문한 날", "op": "atLeast", "value": "2026-09-01"}, {"field": "방문일", "op": "atMost", "value": "2026-09-30"}], "top": 2}\n${fence}`
    expect(queryPlan(reply, fields)).toEqual({
      plan: {
        groupBy: ['원인'],
        filters: [
          { column: '방문일', op: 'atLeast', value: '2026-09-01' },
          { column: '방문일', op: 'atMost', value: '2026-09-30' },
        ],
        top: 2,
      },
    })
  })

  it('counts everything when it names nothing, counts a field named twice once, and keeps a blank condition without a value', () => {
    expect(queryPlan('{"groupBy": []}', fields)).toEqual({ plan: { groupBy: [], filters: [] } })
    expect(queryPlan('{"groupBy": ["@원인", "원인"], "filters": [{"field": "지역", "op": "empty"}], "top": 0}', fields)).toEqual({
      plan: { groupBy: ['원인'], filters: [{ column: '지역', op: 'empty', value: '' }] },
    })
  })

  it('says why it is not a plan: none in the reply, a field the template does not have, a condition it cannot ask', () => {
    expect(queryPlan('세어 보겠습니다.', fields)).toEqual({ problem: 'no-plan' })
    expect(queryPlan('{"groupBy": ["담당"]}', fields)).toEqual({ problem: 'unknown-field', field: '담당' })
    expect(queryPlan('{"filters": [{"field": "원인", "op": "like", "value": "부"}]}', fields)).toEqual({ problem: 'bad-filter', field: '원인' })
    expect(queryPlan('{"filters": [{"field": "원인", "op": "equal", "value": "배터리"}]}', fields)).toEqual({ problem: 'bad-filter', field: '원인' })
    expect(queryPlan('{"filters": [{"field": "지역", "op": "contains", "value": " "}]}', fields)).toEqual({ problem: 'bad-filter', field: '지역' })
  })

  it('passes on that the question cannot be counted from the template, as the model put it', () => {
    expect(queryPlan('{"unanswerable": "담당자 칸이 없습니다"}', fields)).toEqual({ unanswerable: '담당자 칸이 없습니다' })
  })
})
