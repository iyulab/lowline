import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Every module `file` imports, followed through the package's own files: what loading it brings in. */
function imports(file: string, seen = new Set<string>()): Set<string> {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const statements = /^(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm
  for (const [, from, bare] of source.matchAll(statements)) {
    const specifier = from ?? bare
    if (specifier.startsWith('./')) {
      const own = specifier.slice(2).replace(/\.js$/, '.ts')
      if (!seen.has(own)) {
        seen.add(own)
        imports(own, seen)
      }
    } else {
      seen.add(specifier)
    }
  }
  return seen
}

describe('the headless entry', () => {
  it('carries what a host drawing its own form needs', async () => {
    const headless = await import('../src/headless.js')
    expect(Object.keys(headless).sort()).toEqual(['Draft', 'LowlineClient', 'LowlineError', 'Session', 'englishStrings', 'valuesOf'])
  })

  it('brings in neither Lit nor formdown, which the main entry does for the element', () => {
    const outside = (file: string) => [...imports(file)].filter((module) => !module.endsWith('.ts')).sort()
    expect(outside('headless.ts')).toEqual([])
    expect(outside('index.ts')).toEqual(['@formdown/ui', 'lit', 'lit/decorators.js'])
  })
})
