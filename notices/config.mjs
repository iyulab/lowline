// The third-party notices the installer ships beside the app (`npm run notices`, after `build:host`; it
// restores the sidecar project itself before reading its packages, so it needs dotnet): every package
// Lowline ships — the UI's npm packages, the shell's crates, the sidecar's NuGet packages — with the
// license texts it carries, or the one pinned here.
// Paths are relative to this folder.
export default {
  /** Where the installer takes it from (src-tauri/tauri.conf.json `bundle.resources`). */
  out: 'out/THIRD-PARTY-NOTICES.txt',
  title: 'Lowline — third-party notices',
  npm: { lock: '../package-lock.json', installedAt: '..' },
  /** The shell is built for Windows only (`bundle.targets`), so its crates are resolved for it. */
  cargo: { cwd: '../src-tauri', target: 'x86_64-pc-windows-msvc' },
  /** Restored the way `build:host` publishes it — self-contained for win-x64, which ships the runtime packs. */
  nuget: {
    project: '../src-host/Lowline.Host/Lowline.Host.csproj',
    properties: { RuntimeIdentifier: 'win-x64', SelfContained: true },
  },
  pinned: { pins: 'pins.json', dir: 'texts' },
}
