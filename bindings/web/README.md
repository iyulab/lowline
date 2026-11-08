# `<lowline-form>`

A formdown form whose decided fields are suggested from the records people confirmed, talking to a Lowline host's
routes — the contract at the end of this page, which a host implements over the engine (the .NET reference host is
[`samples/aspnet`](../../samples/aspnet)).

```html
<lowline-form src="/lowline" form="intake" record="r-17"></lowline-form>
<script type="module">
  const form = document.querySelector('lowline-form')
  form.content = '@customer: [text]\n@owner: [select options="kim,lee"]'
  // later: await form.save()  ·  await form.fill('customer Beta, owner lee')
</script>
```

| Property | |
|---|---|
| `src` | Where the host's routes are (`/lowline`). |
| `form` | The form, by the name the host defined it under. |
| `record` | The record being written; a record opened again keeps its id, so it is not evidence for itself. |
| `content` | The form's formdown text. |
| `data` | The record's values when it was opened. |
| `rate` | How often a field's answer is held back to check it, from 0 to 1 (one in twenty by default). |
| `prefill` | Whether a suggestion the engine allows to go in unasked is put in the field before the person takes it. Off by default — a value in a field reads as the person's own. |
| `promise-rate` | How often a suggestion's promise — right *n* times in 10 like it, rounded down — is shown beside it, from 0 to 1. Off (0) by default; the draw goes into the record, so showing it can be measured before it is turned on for everyone. |
| `strings` | The words the form shows, in the host's language. |
| `settled-by` | Who is writing, as an opaque id the host gives — one person, one id, never a name. Sent with the save when set. |
| `batch` | The batch the record is written in, when several come at once from one source. Sent with the save when set. |

`save()` sends the values with the account of what was shown, taken and turned down, and fires `lowline-saved`; a
host that stores the record through its own API calls `settle()` after its save instead, which sends only the account
and has the host's engine learn the record as stored (`Saved` in .NET);
`fill(text)` offers the host model's values in their fields. A field the records cannot answer yet is judged by the
host's model when it has one (`judge`): asked once for the values it reads, shown in the field while the person writes
on, never put in on its own. When the routes do not answer, `lowline-unavailable` fires and the form is filled in by
hand. Nothing is counted in the browser: the host's engine counts what it is sent.

A host that draws its own form imports `Draft`, `Session` and `LowlineClient` from `@iyulab/lowline-form/headless`,
which brings in neither Lit nor formdown and registers no element (the package root carries them too, with the element).

The package is `@iyulab/lowline-form`, with Lit and formdown as dependencies. A page with no build step takes the one
file in it that carries both: `dist/bundle/lowline-form.bundle.js`.

```sh
npm ci
npm test
npm run bundle   # one file with Lit and formdown inside, in dist/bundle
```

## The routes a host serves

Under the prefix the host mounted them at (`src`):

| Route | Takes | Answers |
|---|---|---|
| `POST {form}/propose` | `{ "id", "values" }` — the record so far | per open decided field: the suggestion, what it rests on, its `promise`, or why there is none |
| `POST {form}/settle` | `{ "id", "saved", "draft" }` — no `saved` with `Saved` | `{ "id", "settledAt" }`; 400 for a value the form cannot hold, and nothing is learned |
| `GET {form}/report` | — | per decided field: the thresholds chosen, how many records they were chosen on (`chosenOn`), and what the replay of the records saw at them |
| `POST {form}/fill` | `{ "values", "text", "attachments" }` — `attachments`, optional: what the person showed, each `{ "mediaType", "data" (base64), "name" }`; `text` may be empty when something is shown | the model's values as suggestions; 400 for data that is not base64; 404 saying so without a model |
| `POST {form}/judge` | `{ "id", "values" }` | the model's judgements for the fields the records could not answer; 404 saying so without a model |

A form not defined is 404. Each request's memory space and allowed choices come from the host, never from the request
body. The shapes are the engine's own wire shapes: in .NET, `LowlineJson` serializes them.
