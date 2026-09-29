// Copies the brand's pure modules and outputs to the site and the releases repo:
// `npm run brand:sync -- --site ../lowline.site [--releases ../lowline-releases] [--check]`.
// --check writes nothing and fails if a copy differs from its source.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

const BANNER = "// Copy of the app's brand module. Edit the original and run brand:sync.\n"

const SYNC: { from: string; to: 'site' | 'releases'; path: string; banner?: boolean }[] = [
  { from: 'src/brand/geometry.ts', to: 'site', path: 'src/brand/geometry.ts', banner: true },
  { from: 'src/brand/wordmark-glyphs.ts', to: 'site', path: 'src/brand/wordmark-glyphs.ts', banner: true },
  { from: 'src/brand/motion.ts', to: 'site', path: 'src/brand/motion.ts', banner: true },
  { from: 'brand-out/og-ko.png', to: 'site', path: 'public/og-ko.png' },
  { from: 'brand-out/og-en.png', to: 'site', path: 'public/og-en.png' },
  { from: 'brand-out/social.png', to: 'releases', path: 'assets/social.png' },
  { from: 'brand-out/lowline-intro-light.svg', to: 'releases', path: 'assets/lowline-intro-light.svg' },
  { from: 'brand-out/lowline-intro-dark.svg', to: 'releases', path: 'assets/lowline-intro-dark.svg' },
]

const { values } = parseArgs({ options: { site: { type: 'string' }, releases: { type: 'string' }, check: { type: 'boolean' } } })
const roots = { site: values.site, releases: values.releases }
/** Line endings are the checkout's business, not the content's. */
const normalize = (b: Buffer) => b.toString('utf8').replace(/\r\n/g, '\n')

let stale = 0
for (const item of SYNC) {
  const root = roots[item.to]
  if (!root) continue
  const source = readFileSync(item.from)
  const text = item.from.endsWith('.ts') || item.from.endsWith('.svg')
  const want = text ? Buffer.from((item.banner ? BANNER : '') + normalize(source)) : source
  const target = join(root, item.path)
  const have = existsSync(target) ? readFileSync(target) : undefined
  const same = have && (text ? normalize(have) === want.toString('utf8') : have.equals(want))
  if (same) continue
  if (values.check) {
    console.error(`differs: ${target}`)
    stale++
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, want)
  console.log(`wrote ${target}`)
}
if (stale) process.exit(1)
