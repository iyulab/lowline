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

With `LOWLINE_PERF=1`, the web UI tests, the sidecar tests and the end-to-end run also measure what reading and rebuilding a vault of 1,000 and 10,000 documents costs; they are skipped otherwise.

Layout: `src-tauri/` is the shell — the only code that reads or writes files, all inside the open vault folder and all writes atomic. `src/` is the web UI. `src-host/` is the .NET sidecar for projections and suggestions: the shell starts it with the app and a per-launch token, it listens on a loopback port and never touches vault files.

The UI reads the vault's templates and documents and hands the sidecar a snapshot through the shell. The sidecar projects each template into a table (Formbase, in memory) and remembers the values people saved in judgment fields, so a similar document gets the same value suggested (Gil's character-level memory, no model); when nothing saved is close enough it suggests nothing. Where saved documents disagree on the same request, the latest save wins. How close is close enough is chosen per field by replaying its saved documents in the order they were saved — the lowest similarity at which 80% of the replayed suggestions were right — once a field has enough of them, and chosen again as they grow by a tenth; until then a fixed similarity serves. A table row opens its document. Existing records come in by pasting rows copied from a spreadsheet — the first row names the columns — so suggestions have confirmed values to learn from on the first day. The learning view shows, for each judgment field, how often recent suggestions were taken as offered — counted over the fields that got a suggestion, decision by decision, from the event files — so whether suggestions improve with use is something to look at, not to assume. Because that count leaves out the fields that got no suggestion, a field whose threshold has been chosen also shows how its saved documents did on replay: how often one was suggested at all, and how often it was right. Beneath the curves, weekly counts of those decisions — by week, form and judgment field, with forms and fields numbered and nothing else — can be copied to hand to someone studying the curves; which number is which is shown beside them and never copied. The shell watches the places in the vault the app reads — `서식/`, `문서/` and other devices' event files (tauri-kit-watch) — so other programs keeping their own files in the same folder do not disturb it. Edits made there by other programs — another editor, a sync client, another device — show up in the lists, the table and the suggestions; an open document with no unsaved edits is read again, and one with unsaved edits is never replaced — the person is told and saving decides. An open document or template removed outside stays on screen as unsaved, so saving makes it again. The app's own writes are not reported back to it. Unsaved edits are never dropped without asking: opening something else, switching views, opening another vault or closing the window asks first. It keeps nothing on disk: everything is rebuilt from the vault.

A template turns suggestions on for a field by naming it in its front matter:

```yaml
---
id: intake
version: 1
lowline:
  suggest: [담당]
---
```

When a document is saved, what happened to each suggestion — accepted, corrected or rejected — is appended to `.lowline/events/<device>.jsonl` in the vault, one file per install. Suggestions read these files back: a field whose suggestion was last rejected in a document is not suggested in that document again, even after it is reopened.

End-to-end scenarios live in `e2e/`. `npm run build:e2e` builds a debug variant (`src-tauri/tauri.e2e.conf.json`) that exposes the WebView DevTools protocol on port 9223; `npm run test:e2e` copies the fixture vault in `e2e/fixtures/vault/` to a temporary folder, drives the window with clicks and typing, and checks the saved files on disk.

## License

Lowline is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Lowline under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.
