# Lowline

**Local-first forms that learn.**

Lowline is a desktop app for structured notes. You write documents from forms; fields written inline become columns, many documents become tables and views, and the more a form is used, the better it gets at suggesting the fields that need judgment.

- **Local-first** — documents are plain files on your machine. No account is required, and every feature works offline.
- **Forms, not free notes** — a form's fields are part of the text itself. The same document reads as prose and queries as a row.
- **Suggestions that learn from confirmation** — fill in the observed fields and candidate values are suggested for the judgment fields. People confirm; confirmations become the basis for later suggestions.

> Status: early development. Nothing is released yet.

## How it works

- [Vaults, templates and documents](docs/vault.md) — the folder, templates and their versions, documents, tables, finding and importing
- [Suggestions and learning](docs/suggestions.md) — what is suggested and from what, thresholds, the event files, the learning view
- [Working in the app](docs/working.md) — opening where you left off, keyboard, narrow windows
- [Edits from outside the app](docs/outside-edits.md) — other editors, sync clients and their conflict copies, shared folders
- [What stays on this device, and what leaves it](docs/data.md) — caches, the record of suggestions shown, error reports

## Development

Requires Node.js 22.18+, Rust (stable), the .NET 10 SDK and, on Windows, the WebView2 runtime.

```bash
npm install
npm run build:host     # publish the .NET sidecar; the shell bundles it, so build it before cargo
npm run tauri dev      # run the app
npm test               # web UI tests
npm run test:host                                  # sidecar tests
cargo test --manifest-path src-tauri/Cargo.toml   # shell tests
npm run build:e2e && npm run test:e2e              # end-to-end scenarios in the real window
npm run check:installer                            # after `npx tauri build`: install, start, uninstall
```

CI runs the web UI, shell and sidecar tests on Linux for each push, and the end-to-end scenarios in the Windows window on a Windows runner. On a CI runner the scenarios do not look into the Recycle Bin, which its session sees empty; they still check that a deleted file left the vault.

With `LOWLINE_PERF=1`, the web UI tests, the sidecar tests and the end-to-end run also measure what reading and ingesting a vault of 1,000 and 10,000 documents costs — filling an empty cache, one outside edit, a restart, what reference fields cost each time a view draws; they are skipped otherwise.

Layout: `src-tauri/` is the shell — the only code that reads or writes files, all inside the open vault folder and all writes atomic. `src/` is the web UI. `src-host/` is the .NET sidecar for projections and suggestions: the shell starts it with the app and a per-launch token, it listens on a loopback port and never touches vault files. `notices/` holds the license texts of shipped packages that publish without one, each pinned to its source at that version ([notices/README.md](notices/README.md)).

End-to-end scenarios live in `e2e/`. `npm run build:e2e` builds a debug variant (`src-tauri/tauri.e2e.conf.json`) that exposes the WebView DevTools protocol on port 9223; `npm run test:e2e` copies the fixture vault in `e2e/fixtures/vault/` to a temporary folder, drives the window with clicks and typing through [`@iyulab/tauri-kit-dev`](https://github.com/iyulab/tauri-kit-dev), and checks the saved files on disk. `E2E_ONLY=<text>` runs the scenarios whose names hold the text and `E2E_REPEAT=<n>` runs them n times, each on a fresh vault; `e2e/app.mjs` is the window itself — launch, open a vault, click, type, take a picture, quit — for a script that walks a flow of its own.

`npm run check:installer` checks an installer the way a person gets the app: installed for the current user into a temporary folder, started — with the sidecar running from the installed folder — closed, which ends the sidecar too, and uninstalled. The installed app uses its real identifier, so run it where no Lowline of your own is in use, or on an installer built with `--config src-tauri/tauri.e2e.conf.json`; the release pipeline runs it before an installer is uploaded.

## License

Lowline is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Lowline under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.
