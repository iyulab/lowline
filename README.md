# Lowline

**Local-first forms that learn.**

Lowline is a desktop app for structured notes. You write documents from forms; fields written inline become columns, many documents become tables and views, and the more a form is used, the better it gets at suggesting the fields that need judgment.

- **Local-first** — documents are plain files on your machine. No account is required, and every feature works offline.
- **Forms, not free notes** — a form's fields are part of the text itself. The same document reads as prose and queries as a row.
- **Suggestions that learn from confirmation** — fill in the observed fields and candidate values are suggested for the judgment fields. People confirm; confirmations become the basis for later suggestions.

> Status: early development. Nothing is released yet.

## Development

Requires Node.js 22+, Rust (stable), the .NET 10 SDK and, on Windows, the WebView2 runtime.

```bash
npm install
npm run build:host     # publish the .NET sidecar; the shell bundles it, so build it before cargo
npm run tauri dev      # run the app
npm test               # web UI tests
npm run test:host                                  # sidecar tests
cargo test --manifest-path src-tauri/Cargo.toml   # shell tests
npm run build:e2e && npm run test:e2e              # end-to-end scenarios in the real window
```

Layout: `src-tauri/` is the shell — the only code that reads or writes files, all inside the open vault folder and all writes atomic. `src/` is the web UI. `src-host/` is the .NET sidecar for projections and suggestions: the shell starts it with the app and a per-launch token, it listens on a loopback port and never touches vault files.

End-to-end scenarios live in `e2e/`. `npm run build:e2e` builds a debug variant (`src-tauri/tauri.e2e.conf.json`) that exposes the WebView DevTools protocol on port 9223; `npm run test:e2e` copies the fixture vault in `e2e/fixtures/vault/` to a temporary folder, drives the window with clicks and typing, and checks the saved files on disk.

## License

Lowline is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Lowline under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.
