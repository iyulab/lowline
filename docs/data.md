# What stays on this device, and what leaves it

The vault's files are the only originals. Everything else the app keeps can be deleted without losing anything.

## Kept on this device, outside the vault

In the app's local data, one file each per vault:

- A cache of the tables and the index of the documents' values. It is rebuilt from the vault.
- The strength each judgment field's replay chose for the values saved together, so the next launch starts from them instead of replaying its history again. They are chosen again from the vault if the file is gone.
- A record of the suggestions this device showed for the vault: when, for which template and field, and from where — never the value. Nothing learns from it; it is counted, so decisions can be read against what was shown, including suggestions whose document was never saved.

In the app's settings: this install's id, and where the app was when last used (see [Working in the app](working.md)).

## Error reports

When something fails, an error report is written to `reports.jsonl` in the app's log folder: the layer, the kind of failure (a class name or an app-owned code), the frames of the app's own code, the version and the operating system — never a message, a path, a file name, a template or a value.

A release build sends the reports written since its last send on the next launch, over the operating system's TLS and certificate store. The file stays, so what was sent can still be read, until it passes 1 MiB and a launch drops its oldest reports. A build made without somewhere to send them — every development build — sends nothing.
