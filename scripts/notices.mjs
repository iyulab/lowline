// Writes THIRD-PARTY-NOTICES.txt, which the installer ships next to the app: every package Lowline
// ships — the UI's npm packages, the shell's crates, the sidecar's NuGet packages — with its license
// and the license texts it carries, or the text pinned in notices/ for one that publishes without it.
// Runs after `build:host`, which restores the sidecar's packages this reads.
//
//   node scripts/notices.mjs            write it; fail on a pin that no longer applies or does not match
//   node scripts/notices.mjs --strict   also fail on a package left without a license text — for a
//                                       release that goes out to the public
//
// Nothing is fetched: the texts come from the installed packages and from notices/texts.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyPinned,
  cargoPackages,
  noticesText,
  npmPackages,
  nugetPackages,
  withoutText,
  writeOrCheck,
} from '@iyulab/tauri-kit-dev/notices'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Where the installer takes it from (src-tauri/tauri.conf.json `bundle.resources`). */
const OUT = join(root, 'notices', 'out', 'THIRD-PARTY-NOTICES.txt')
/** The shell is built for Windows only (`bundle.targets`), so its crates are resolved for it. */
const TARGET = 'x86_64-pc-windows-msvc'

const strict = process.argv.includes('--strict')

const shipped = [
  ...npmPackages({ lock: join(root, 'package-lock.json'), installedAt: root }),
  ...cargoPackages({ cwd: join(root, 'src-tauri'), target: TARGET }),
  ...nugetPackages({ assets: join(root, 'src-host', 'Lowline.Host', 'obj', 'project.assets.json') }),
]
const { packages, unused, problems } = applyPinned(shipped, {
  pins: join(root, 'notices', 'pins.json'),
  dir: join(root, 'notices', 'texts'),
})
const missing = withoutText(packages)

const failures = [
  ...unused.map((key) => `pin ${key} applies to no shipped package — remove it, or pin the version now shipped`),
  ...problems.map(({ key, problem }) => `pin ${key}: ${problem}`),
  ...(strict ? missing.map((p) => `${p.name} ${p.version} ships without its license text — pin it (notices/README.md)`) : []),
]

mkdirSync(dirname(OUT), { recursive: true })
writeOrCheck(OUT, noticesText(packages, { title: 'Lowline — third-party notices' }))
console.log(`notices: ${packages.length} packages, ${missing.length} without a license text → ${OUT}`)
if (!strict) for (const p of missing) console.warn(`  without a license text: ${p.name} ${p.version}`)
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
