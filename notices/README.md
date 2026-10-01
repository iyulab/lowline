# Pinned license texts

Some packages Lowline ships declare a license but publish without its text. The text then comes
from the package's own source at the same version, and stays that text:

- `pins.json` maps `name@version` to the file it was taken from — a URL fixed to a commit — and the
  file's SHA-256 (a list where a license spans several files, such as Apache-2.0's NOTICE).
- `texts/` holds those files as fetched.

The third-party notices are generated from the packages' own texts and these pinned ones, reading
only what is committed here. A package that moves to another version no longer matches its pin and
has to be pinned again — its text may have changed.

To pin a package, add an entry with its `source` alone and fetch:

```
npx tauri-kit-dev notice-pins --pins notices/pins.json --dir notices/texts
```

The command downloads each text, records the digest of a new entry, and refuses a source that no
longer matches its recorded digest.
