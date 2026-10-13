// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:e2e   builds the debug app with the e2e config (debugging port 9223)
//   npm run test:e2e    copies the fixture vault to a temp folder and runs every scenario
//                       (E2E_SCREENSHOTS=<dir> saves a picture of the window after each one;
//                       E2E_COLOR_SCHEME=dark runs it in the dark scheme;
//                       E2E_VAULT_UNC=1 opens the vault through this PC's administrative share,
//                       \\localhost\C$\..., so every file operation goes over SMB — Windows only;
//                       `-- --only <text>` runs the scenarios whose names hold the text, `-- --through
//                       <text>` those up to the first such, `-- --repeat <n>` n times, each on a fresh
//                       vault in a fresh window; a failure's picture is kept in the temp folder)
//
// The window itself — launching, clicking, typing, quitting — is app.mjs, for one-off scripts too.
//
// The one seam: the folder picker is a native dialog, so the vault is opened through the same
// `open_vault` command the picker's result goes to. Everything after that is clicks and typing.
//
// Scenarios live in scenarios/, one file per area of the app; they run in the order below, each building on
// the files the last one left. What they share is shared.mjs.

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { App, IDENTIFIER, SETTINGS, exe, sidecarsRunning } from './app.mjs'
import { here, shown } from './shared.mjs'
import { runScenarios } from '@iyulab/tauri-kit-dev/app'
import templates from './scenarios/templates.mjs'
import documents from './scenarios/documents.mjs'
import suggestions from './scenarios/suggestions.mjs'
import tablesAndFinding from './scenarios/tables-and-finding.mjs'
import judgments from './scenarios/judgments.mjs'
import filesAndConflicts from './scenarios/files-and-conflicts.mjs'
import templateVersions from './scenarios/template-versions.mjs'
import app from './scenarios/app.mjs'

const scenarios = {
  ...templates,
  ...documents,
  ...suggestions,
  ...tablesAndFinding,
  ...judgments,
  ...filesAndConflicts,
  ...templateVersions,
  ...app,
}

/**
 * A fresh start for one run: the fixture vault copied to a new folder — reached over SMB with
 * E2E_VAULT_UNC — this device's settings as a fresh install's, and the app opened on the vault.
 */
async function start() {
  const local = await mkdtemp(join(tmpdir(), 'lowline-e2e-'))
  await cp(join(here, 'fixtures', 'vault'), local, { recursive: true })
  // A shared folder: the same files, reached over SMB. Needs the drive's administrative share.
  const vault = process.env.E2E_VAULT_UNC ? local.replace(/^([A-Za-z]):/, (_, drive) => '\\\\localhost\\' + drive.toUpperCase() + '$') : local
  const stop = () => rm(local, { recursive: true, force: true })
  try {
    // Each run's vault is a new folder, so an earlier run's projection cache and record of suggestions
    // shown would only pile up.
    for (const dir of ['projections', 'presentations'])
      await rm(join(process.env.LOCALAPPDATA ?? tmpdir(), IDENTIFIER, dir), { recursive: true, force: true })
    // This device's settings start as a fresh install's, past the first launch's one-time line about what
    // leaves the computer (its own scenario shows it).
    await mkdir(dirname(SETTINGS), { recursive: true })
    await writeFile(SETTINGS, JSON.stringify({ outboundToldOnce: true }))
    const app = await App.launch()
    await app.openVault(vault)
    // Scenarios run in order against one window: each builds on the files the last one left.
    return { app, context: vault, stop }
  } catch (e) {
    await stop()
    throw e
  }
}

if (!existsSync(exe)) throw new Error(`no e2e build at ${exe} — run \`npm run build:e2e\` first`)
let code = await runScenarios(scenarios, { start, shown })
// The sidecar lives in the app's job object: when the app is gone, so is the sidecar.
if (process.platform === 'win32' && (await sidecarsRunning()) > 0) {
  console.log('  ✗ the sidecar outlived the app')
  code = 1
}
process.exitCode = code
