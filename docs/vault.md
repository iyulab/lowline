# Vaults, templates and documents

## A vault is a folder

Everything Lowline keeps is a file in a folder you choose, the vault: templates in `서식/`, documents in `문서/`, and the record of what happened to suggestions in `.lowline/events/`. Other programs may keep their own files in the same folder; Lowline reads only its own places.

The first screen opens an existing folder or makes a new vault in an empty one, starting from a sample template with one judgment field turned on and no documents — suggestions learn only from what a person saves.

The sidebar lists the vault's templates. Each shows its documents (first), its table and its source; a new template starts from the end of that list. Documents naming no template the vault has are listed apart while there are any.

## Templates

A template is a Formdown form. Its front matter gives it an `id` and a `version`, and names the fields suggestions are turned on for — its judgment fields:

```yaml
---
id: intake
version: 1
lowline:
  suggest: [담당]
---
```

The file stays a plain Formdown template: `lowline` is a key other Formdown tools ignore.

On a template's page:

- Judgment fields are turned on and off with a checkbox per field, written into `lowline.suggest`.
- A choice field's options are edited in the field list and written back into that field in the source, nowhere else.
- **Rename** in the field list changes what a field shows — its `label` — and leaves its name as it is. A field's name is what documents record its value under and what suggestions learn by, so the values and what was learned stay with it. Renaming the field in the source instead makes it a new field; the page then says which documents hold values in a field the source no longer has.
- Typing in the source completes a field just started — `@` after three underscores, for the field's name, and `[]` after `@name: `, for its type — and one undo takes the completion away.
- Problems in the source are listed above it: a field name used twice (documents keep one value per name, so the field is read as it first appears), a condition that names a field the template does not have, a judgment field that is not a field, and another template file with the same id.

### Versions

A template's versions are revisions of one template: its identity is its `id`. Raising the version keeps its documents in its list and its table, and what they confirmed keeps suggesting. The table's columns are the fields of the version now.

Documents record the version they were written with and are never rewritten for it. A document of an earlier version opens as it was written, with a line saying which version; **Move to the version now** gives that one document the version's body and names the version, and keeps every value in its front matter — a value in a field the version no longer has included — and its id.

Two template files with one id are one template twice: the vault reads the later version as the template, and the template's page says so.

## Documents

A document is a copy of its template's body whose front matter records the template, the document's own id and the values. `template` and `lowline` are the document's own keys, so a template cannot have fields by those names:

```yaml
---
template: intake@1
lowline:
  id: 5f0c2c1e-8a47-4f3b-9d6e-2b1f7c9a0e44
요청: 노트북 배터리가 금방 닳아요
부서: 영업
---
```

What is recorded about a document — its suggestion events, the rejections that hold in it, what suggestions learn from it — is keyed by that id, so it stays with the document when its file is renamed or moved. A document without one — written before documents had ids, or by another tool — is known by its path, the key its earlier events were recorded under; the app does not add ids to files nobody asked it to save.

- A new document is named by its day and its first value.
- Renaming a document renames its file within its folder — never over another file — and a document known by its path is given that path as its id first. A template is renamed the same way on its page; documents name their template by its id, so they stay with it.
- Deleting a document or a template moves its file to the system's trash, after asking. Where a location has no trash, the file stays until the person chooses to delete it for good. A deleted template's documents are kept, and listed apart as documents whose template the vault does not have.
- Documents and templates are listed by their file names. A template's documents are listed the last name first — a new document's name starts with its day, so the latest are on top — and a sync conflict copy follows its original.
- A file copied outside the app keeps its original's id; the copy that is then saved with a change gets a new one and becomes a document of its own.

## Tables, finding and importing

A template's table has a row per document and a column per field. It filters by name, by a choice field's value, by words in a field and by a number field's range, and it exports as CSV. A table row opens its document.

A template's list of documents finds them by their names or by the words of their values — a value's line that matched is shown beside it. An open document shows, when asked, the documents of its template most like it, leaving out those whose values are still in doubt. The words are looked up in an index of the documents' values (FluxIndex, character pairs for Korean, no model). These similar documents are for a person to look at; they never fill in a field.

Existing records come in by pasting rows copied from a spreadsheet — the first row names the columns — so suggestions have confirmed values to learn from on the first day.
