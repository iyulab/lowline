# `<lowline-form>`

A formdown form whose decided fields are suggested from the records people confirmed, talking to a Lowline host's
routes (`MapLowline` in .NET).

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
| `strings` | The words the form shows, in the host's language. |

`save()` sends the values with the account of what was shown, taken and turned down, and fires `lowline-saved`; a
host that stores the record through its own API calls `settle()` after its save instead, which sends only the account
and has the host's engine learn the record as stored (`Saved` in .NET);
`fill(text)` offers the host model's values in their fields. A field the records cannot answer yet is judged by the
host's model when it has one (`judge`): asked once for the values it reads, shown in the field while the person writes
on, never put in on its own. When the routes do not answer, `lowline-unavailable` fires and the form is filled in by
hand. Nothing is counted in the browser: the host's engine counts what it is sent.

`Draft`, `Session` and `LowlineClient` are exported for a host that draws its own form.

The package is `@iyulab/lowline-form`, with Lit and formdown as dependencies. A page with no build step takes the one
file in it that carries both: `dist/bundle/lowline-form.bundle.js`.

```sh
npm ci
npm test
npm run bundle   # one file with Lit and formdown inside, in dist/bundle
```
