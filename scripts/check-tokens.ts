// Every design token the app reads must be defined. A `var(--dc-…, fallback)` whose token the
// design system does not have falls back silently — to a light default that shows as a white box in
// the dark scheme. Run by `npm test`.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const stylesheets = [
  'node_modules/@iyulab/desktop-compact/tokens.css',
  'node_modules/@iyulab/desktop-patterns/tokens.css',
  'src/styles.css',
]
const defined = new Set(
  stylesheets.flatMap((f) => [...readFileSync(join(root, f), 'utf8').matchAll(/(--dc-[a-z0-9-]+)\s*:/g)].map((m) => m[1])),
)

const missing: string[] = []
for (const file of readdirSync(join(root, 'src')).filter((f) => /\.(ts|css)$/.test(f))) {
  for (const m of readFileSync(join(root, 'src', file), 'utf8').matchAll(/var\((--dc-[a-z0-9-]+)/g))
    if (!defined.has(m[1])) missing.push(`${m[1]} in src/${file}`)
}

if (missing.length > 0) {
  console.error(`[tokens] not defined by the design system:\n  ${[...new Set(missing)].join('\n  ')}`)
  process.exit(1)
}
console.log(`[tokens] ok — ${defined.size} defined`)
