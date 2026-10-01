# What stays on this device, and what leaves it

The vault's files are the only originals. Everything else the app keeps can be deleted without losing anything.

## Kept on this device, outside the vault

In the app's local data, one file each per vault:

- A cache of the tables and the index of the documents' values. It is rebuilt from the vault.
- The strength each judgment field's replay chose for the values saved together, so the next launch starts from them instead of replaying its history again. They are chosen again from the vault if the file is gone.
- A record of the suggestions this device showed for the vault: when, for which template and field, and from where — never the value. Nothing learns from it; it is counted, so decisions can be read against what was shown, including suggestions whose document was never saved.

In the app's settings: this install's id, where the app was when last used (see [Working in the app](working.md)), and whether to check for updates.

## Error reports

When something fails, an error report is written to `reports.jsonl` in the app's log folder: the layer, the kind of failure (a class name or an app-owned code), the status a failed request to the sidecar was answered with, the frames of the app's own code, the version and the operating system — never a message, a path, a file name, a template or a value.

A release build sends the reports written since its last send on the next launch, over the operating system's TLS and certificate store. The file stays, so what was sent can still be read, until it passes 1 MiB and a launch drops its oldest reports. A build made without somewhere to send them — every development build — sends nothing.

## Updates

A release build checks for a newer release when it starts and once a day while it runs: it reads one public file, the latest release's `latest.json` on GitHub. The request carries what any download does — the address it comes from — and names the updater component and its version; nothing of the vault, the app's version or the operating system goes with it. The check can be turned off under 정보 (About); it is on until then.

A newer release is installed only when the person chooses to install it, after the app has asked about any unsaved edits, and only if its update signature is valid. The sidecar is stopped before the installer replaces it, and the new release starts in its place. A development build checks nowhere unless `LOWLINE_UPDATE_ENDPOINT` names a place.
