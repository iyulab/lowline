# Pinned license texts

Some packages Lowline ships declare a license but publish without its text. The text then comes
from the package's own source at the same version, and stays that text:

- `pins.json` maps `name@version` to the file it was taken from — a URL fixed to a commit — and the
  file's SHA-256 (a list where a license spans several files, such as Apache-2.0's NOTICE).
- `texts/` holds those files as fetched.

These are what the third-party notices take for such a package, alongside the texts the other
packages carry themselves — read from what is committed here, never fetched while generating.
A package that moves to another version no longer matches its pin and has to be pinned again — its
text may have changed.

`npm run notices` writes the notices to `out/THIRD-PARTY-NOTICES.txt` (not committed), which the
installer ships beside the app and the app shows under 정보 at the foot of its sidebar; `build:host` runs it. It fails on a pin that applies to no shipped
package or whose file does not match its digest, and lists the packages still without a text. With
`-- --strict` it fails on those too — a release that goes out to the public is built that way.

To pin a package, add an entry with its `source` alone and fetch (`@iyulab/tauri-kit-dev` 0.2 or later):

```
npx tauri-kit-dev notice-pins --pins notices/pins.json --dir notices/texts
```

The command downloads each text, records the digest of a new entry, and refuses a source that no
longer matches its recorded digest.
