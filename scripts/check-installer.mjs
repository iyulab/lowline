// Checks the installer the way a person gets the app: installed silently for this user into a temporary
// folder, started — and the sidecar it ships starts with it, from the installed folder — then closed,
// taking the sidecar with it, and uninstalled. Windows only.
//
//   node scripts/check-installer.mjs [<installer>]
//
// Without an argument it takes the installer of this version from the bundle folder (`tauri build`).
// The installed app is the app itself, with its own identifier: run it where no one keeps their Lowline
// (a build runner), or check an installer built with the e2e config.

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findInstaller, withInstalled } from '@iyulab/tauri-kit-dev/installer'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { productName, version } = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const EXE = `${productName}.exe`
const SIDECAR = 'Lowline.Host.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The running processes named `name` whose executable is under `folder`. */
function runningFrom(name, folder) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='${name}'" | Where-Object { $_.ExecutablePath -like '${folder.replaceAll("'", "''")}\\*' } | Measure-Object | Select-Object -ExpandProperty Count`
  return Number(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim())
}

async function until(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await sleep(500)
  }
  return false
}

const installer = process.argv[2] ?? findInstaller(join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis'), { version, hint: 'run `npx tauri build --bundles nsis` first' })
console.log(`installer: ${installer}`)

await withInstalled(
  installer,
  async (target) => {
    const app = spawn(join(target, EXE), [], { stdio: 'ignore' })
    try {
      if (!(await until(() => runningFrom(SIDECAR, target) > 0, 30_000))) throw new Error(`the installed app did not start ${SIDECAR} from ${target}`)
      console.log(`  ✓ installed, started, and its sidecar runs from the installed folder`)
      await sleep(3_000)
      if (app.exitCode !== null) throw new Error(`the installed app exited (${app.exitCode}) while its sidecar ran`)
      console.log(`  ✓ stays up`)
    } finally {
      app.kill()
      await new Promise((done) => (app.exitCode !== null || app.signalCode !== null ? done() : app.once('exit', done)))
    }
    // The sidecar lives in the app's job object: when the app goes, so does the sidecar.
    if (!(await until(() => runningFrom(SIDECAR, target) === 0, 10_000))) throw new Error(`${SIDECAR} outlived the installed app`)
    console.log(`  ✓ closing the app ends its sidecar`)
  },
  { exe: EXE, prefix: 'lowline-installed-' },
)
console.log(`  ✓ uninstalled`)
