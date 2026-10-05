# Edits from outside the app

The shell watches the places in the vault the app reads — `서식/`, `문서/` and other devices' event files (tauri-kit-watch) — so other programs keeping their own files in the same folder do not disturb it. The app's own writes are not reported back to it.

Edits made there by other programs — another editor, a sync client, another device — show up in the lists, the table and the suggestions.

- An open document with no unsaved edits is read again.
- One with unsaved edits is never replaced: the person is told, and saving decides. A notice that leaves the file as it is on screen changes nothing, and an edit made while the file is being read counts as unsaved.
- Before saving, the app checks the file is still what it read; an edit made there since is not overwritten unseen.
- An open document or template removed outside stays on screen as unsaved, so saving makes it again.

## Sync conflict copies

When a sync client keeps both devices' edits of a file as a copy beside it, the list shows the copy with its original and neither is read twice. Until the person keeps one of the two, the original stays in its table, but suggestions do not learn from it and the weekly counts leave it out.

## Programs that write documents

Another program may add documents to the vault — an automation that turns incoming mail into new records, for example. The app reads them like any other edit from outside. A value in a judgment field is taken as a person's decision: it is what suggestions learn the right answer from. So a program writing documents should fill in the observed fields and leave the judgment fields empty, for a person to confirm in the app with its suggestions. Judgment values a program fills in are learned from as if someone had decided them.

## Shared folders

A vault may sit on a shared folder. Where a location has no trash — a network share, some removable drives — deleting never happens silently: the app says the file could not be moved to a trash, and deletes it for good only when the person chooses so.
