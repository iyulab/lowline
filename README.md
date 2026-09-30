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

CI runs the web UI, shell and sidecar tests on Linux for each push; the end-to-end scenarios drive the Windows window and run locally.

With `LOWLINE_PERF=1`, the web UI tests, the sidecar tests and the end-to-end run also measure what reading and ingesting a vault of 1,000 and 10,000 documents costs — filling an empty cache, one outside edit, a restart; they are skipped otherwise.

Layout: `src-tauri/` is the shell — the only code that reads or writes files, all inside the open vault folder and all writes atomic. `src/` is the web UI. `src-host/` is the .NET sidecar for projections and suggestions: the shell starts it with the app and a per-launch token, it listens on a loopback port and never touches vault files.

A vault is a folder. The first screen opens an existing one or makes a new one in an empty folder, starting from a sample template with one judgment field turned on and no documents — suggestions learn only from what a person saves. The sidebar lists the vault's templates; each shows its table, its source and its documents, and a new template starts from the end of that list. Documents naming no template the vault has are listed apart while there are any. The UI reads the vault's templates and documents and hands the sidecar a snapshot through the shell. The sidecar projects each template into a table (Formbase over SQLite, each document a record keyed by its path, so an edit adds only what changed) and remembers the values people saved in judgment fields, so a similar document gets the same value suggested (Gil's character-level memory, no model); when nothing saved is close enough it suggests nothing. Which fields are judgment fields is chosen on the template's page, a checkbox per field, and kept in the template's front matter (`lowline.suggest`) — the file stays a plain Formdown template; a document being filled in names them above the form. Typing in the source completes a field just started — `@` after three underscores, for the field's name, and `[]` after `@name: `, for its type — and one undo takes the completion away. The same page edits a choice field's options, written back into that field in the source and nowhere else. A suggestion is drawn by its field: the value to take — shown in an empty text field in place of its placeholder — what it rests on, and a way to decline it. A field that another field decides — where replaying its saved documents shows the other field's value alone gets it right often enough — is also suggested from the values saved alongside that value, and the suggestion says which value it rests on. Where saved documents disagree on the same request, the latest save wins. How close is close enough is chosen per field by replaying its saved documents in the order they were saved — the lowest similarity at which 80% of the replayed suggestions were right — once a field has enough of them, and chosen again as they grow by a tenth; until then a fixed similarity serves. A table row opens its document. Existing records come in by pasting rows copied from a spreadsheet — the first row names the columns — so suggestions have confirmed values to learn from on the first day. The learning view shows, for each judgment field, how often recent suggestions were taken as offered — counted over the fields that got a suggestion, decision by decision, from the event files — so whether suggestions improve with use is something to look at, not to assume; until ten have been decided it gives the count right, not a share. A judgment field left without a suggestion says so beside it, and how many confirmed documents it had to learn from. Because that count leaves out the fields that got no suggestion, a field whose threshold has been chosen also shows how its saved documents did on replay: how often one was suggested at all, and how often it was right. Beneath the curves, weekly counts of those decisions and of the suggestions this device showed — by week, form and judgment field, with forms and fields numbered and nothing else — can be copied to hand to someone studying the curves; which number is which is shown beside them and never copied. The shell watches the places in the vault the app reads — `서식/`, `문서/` and other devices' event files (tauri-kit-watch) — so other programs keeping their own files in the same folder do not disturb it. Edits made there by other programs — another editor, a sync client, another device — show up in the lists, the table and the suggestions; an open document with no unsaved edits is read again, and one with unsaved edits is never replaced — the person is told and saving decides. A notice that leaves the file as it is on screen changes nothing, and an edit made while the file is being read counts as unsaved. An open document or template removed outside stays on screen as unsaved, so saving makes it again. When a sync client keeps both devices' edits of a file as a copy beside it, the list shows the copy with its original and neither is read twice; until the person keeps one of the two, the original stays in its table but suggestions do not learn from it and the weekly counts leave it out. The app's own writes are not reported back to it. Unsaved edits are never dropped without asking: opening something else, switching views, opening another vault or closing the window asks first. Outside the vault it keeps a cache of the tables, one file per vault in the app's local data — deleting it loses nothing, and it is rebuilt from the vault — and, beside it, a record of the suggestions it showed for each vault: when, for which template and field, and from where, never the value. Nothing learns from that record; it is counted, so decisions can be read against what was shown, including suggestions whose document was never saved. When something fails, an error report is written to `reports.jsonl` in the app's log folder — the layer, the kind of failure (a class name or an app-owned code), the frames of the app's own code, the version and the operating system; never a message, a path, a file name, a template or a value. A release build sends the reports written since its last send on the next launch, over the operating system's TLS and certificate store; the file stays, so what was sent can still be read, until it passes 1 MiB and a launch drops its oldest reports. A build made without somewhere to send them — every development build — sends nothing.

A template turns suggestions on for a field by naming it in its front matter:

```yaml
---
id: intake
version: 1
lowline:
  suggest: [담당]
---
```

A document is a copy of its template's body whose front matter records the template, the document's own id and the values; `template` and `lowline` are the document's own keys, so a template cannot have fields by those names:

```yaml
---
template: intake@1
lowline:
  id: 5f0c2c1e-8a47-4f3b-9d6e-2b1f7c9a0e44
요청: 노트북 배터리가 금방 닳아요
부서: 영업
---
```

What is recorded about a document — its suggestion events, the rejections that hold in it, what suggestions learn from it — is keyed by that id, so it stays with the document when its file is renamed or moved. A document without one — written before documents had ids, or by another tool — is known by its path, the key its earlier events were recorded under; the app does not add ids to files nobody asked it to save. Renaming a document in the app renames its file within its folder — never over another file — and a document known by its path is given that path as its id first. A template is renamed the same way on its page; documents name their template by its id, so they stay with it. Deleting a document or a template moves its file to the system's trash, after asking; where a location has no trash, the file stays until the person chooses to delete it for good. A deleted template's documents are kept, and listed apart as documents whose template the vault does not have. Documents and templates are listed by their file names. A file copied outside the app keeps its original's id; the copy that is then saved with a change gets a new one and becomes a document of its own.

When a document is saved, what happened to each suggestion — accepted, corrected or rejected — is appended to `.lowline/events/<device>.jsonl` in the vault, one file per install, with the template's version, the fields already filled when it was made (names only, in the order they were filled) and when it was shown and taken or rejected. Suggestions read these files back: a field whose suggestion was last rejected in a document is not suggested in that document again, even after it is reopened.

End-to-end scenarios live in `e2e/`. `npm run build:e2e` builds a debug variant (`src-tauri/tauri.e2e.conf.json`) that exposes the WebView DevTools protocol on port 9223; `npm run test:e2e` copies the fixture vault in `e2e/fixtures/vault/` to a temporary folder, drives the window with clicks and typing, and checks the saved files on disk.

## License

Lowline is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Lowline under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.
