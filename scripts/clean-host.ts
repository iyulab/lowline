// Clears the sidecar's publish output, and the copies of it earlier shell builds left in `target/`,
// before the sidecar is published again. `dotnet publish` and Tauri both add and overwrite files but
// never remove one, so a file a new build no longer produces (a native library now bundled into the
// single file, say) would stay beside it and hide the difference.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
for (const dir of ['src-host/publish', 'src-tauri/target/debug/host', 'src-tauri/target/release/host']) {
  rmSync(join(root, dir), { recursive: true, force: true })
}
