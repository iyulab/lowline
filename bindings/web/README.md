# `<lowline-form>`

A formdown form whose decided fields are suggested from the records people confirmed, talking to a Lowline host's
routes (`MapLowline` in .NET). Not published yet.

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

`save()` sends the values with the account of what was shown, taken and turned down, and fires `lowline-saved`;
`fill(text)` offers the host model's values in their fields. When the routes do not answer, `lowline-unavailable` fires
and the form is filled in by hand. Nothing is counted in the browser: the host's engine counts what it is sent.

`Draft`, `Session` and `LowlineClient` are exported for a host that draws its own form.

```sh
npm ci
npm test
npm run bundle   # one file with Lit and formdown inside, in dist/bundle
```
