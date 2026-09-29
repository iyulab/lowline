// What a full read of a vault costs on this side at 1,000 and 10,000 documents — opening it, or
// after the watch lost changes; an outside edit parses only what changed. Runs only with LOWLINE_PERF=1.
import { describe, expect, it } from 'vitest'
import { documentSnapshot } from '../projection.js'

const source = (i: number) => `---
template: intake@1
요청: 노트북 배터리가 금방 닳아요 (${i})
부서: 영업
담당: 장비
---
# 접수

요청: ___@요청

@부서: [select options="영업,개발,인사"]

@담당: [select options="장비,인사,총무"]
`

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

describe.runIf(env.LOWLINE_PERF === '1')('reading a vault', () => {
  for (const count of [1_000, 10_000]) {
    it(`parses ${count} documents`, { timeout: 120_000 }, () => {
      const sources = Array.from({ length: count }, (_, i) => source(i))
      const started = performance.now()
      const parsed = sources.map((s, i) => documentSnapshot(`문서/${i}.md`, s))
      const ms = Math.round(performance.now() - started)
      expect(parsed.every(Boolean)).toBe(true)
      console.log(`${count} docs · parse ${ms} ms`)
    })
  }
})
