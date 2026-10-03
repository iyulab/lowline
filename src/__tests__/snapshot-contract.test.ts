// The vault as the UI hands it to the sidecar, written to a file the sidecar's tests read: what the UI
// sends is pinned here, and there each field is either read or left out on purpose — a field the sidecar
// silently drops (as a choice field's options once were) fails one side or the other.
import { describe, expect, it } from 'vitest'
import { newDocument } from '../documents.js'
import { suggestionEvents } from '../events.js'
import { documentSnapshot, templateSnapshot, type VaultSnapshot } from '../projection.js'

const intake = `---
id: intake
version: 2
lowline:
  suggest: [담당]
---
# 접수

@요청: [textarea]

@부서: [select options="영업,개발"]

@담당: [radio options="장비,총무"]

@태그: [checkbox options="급함,반복"]

@고객 -> customer: [select]
`

describe('the vault the sidecar is handed', () => {
  it('is the shape the sidecar reads', async () => {
    const template = templateSnapshot(intake)
    const source = newDocument(intake, { 요청: '모니터가 깜빡여요', 부서: '영업', 담당: '장비', 태그: ['급함'], 고객: 'customer-1' }, 'doc-1')
    const document = documentSnapshot('문서/2026-10-03-모니터.md', source, 1_790_000_000_000)!
    const events = suggestionEvents(
      new Map([['담당', { suggestion: { value: '장비', mode: 'key', source: '부서: 영업' }, shown: new Date('2026-10-03T00:00:00Z'), filled: ['요청', '부서'], decided: new Date('2026-10-03T00:00:05Z') }]]),
      new Set(),
      { 담당: '장비' },
      document.id,
      new Date('2026-10-03T00:00:10Z'),
      template.ref,
    )
    const vault: VaultSnapshot = { templates: [template], documents: [{ ...document, conflicted: true }], events }
    await expect(JSON.stringify(vault, null, 2) + '\n').toMatchFileSnapshot('../../src-host/Lowline.Host.Tests/ui-snapshot.json')
  })
})
