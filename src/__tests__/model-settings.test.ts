import { describe, expect, it } from 'vitest'
import { MODEL_PRESETS, destinationText, failureText, presetOf } from '../model-settings.ts'
import type { ModelFailure } from '../vault-client.ts'

describe('model settings', () => {
  it('offer servers on the person’s own computers first, and say who receives what is sent otherwise', () => {
    const outside = MODEL_PRESETS.map((p) => p.outside !== null)
    expect(outside.indexOf(true)).toBeGreaterThan(outside.lastIndexOf(false))
    expect(destinationText(presetOf('anthropic')!)).toContain('Anthropic')
    expect(destinationText(presetOf('ollama')!)).not.toContain('Anthropic')
  })

  it('ask a company’s service for a key, and a server of the person’s own for an address when it has no default', () => {
    for (const p of MODEL_PRESETS.filter((p) => p.outside)) expect(p.key).toBe('required')
    expect(presetOf('custom')!.address).toBe('required')
    expect(presetOf('ollama')!.address).toBe('optional')
  })

  it('word every failure the sidecar can name, and never pass on the endpoint’s own words', () => {
    const failures: ModelFailure[] = ['invalid', 'unauthorized', 'http-status', 'timeout', 'refused', 'host-not-found', 'unreachable', 'transport']
    const texts = failures.map((f) => failureText(f, 404))
    expect(new Set(texts).size).toBe(failures.length)
    expect(failureText('http-status', 404)).toContain('404')
    expect(failureText('http-status', null)).not.toContain('HTTP')
  })
})
