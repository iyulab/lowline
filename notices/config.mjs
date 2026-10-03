// The third-party notices the installer ships beside the app (`npm run notices`, after `build:host`, which
// restores the sidecar's packages read here): every package Lowline ships — the UI's npm packages, the
// shell's crates, the sidecar's NuGet packages — with the license texts it carries, or the one pinned here.
// Paths are relative to this folder.
export default {
  /** Where the installer takes it from (src-tauri/tauri.conf.json `bundle.resources`). */
  out: 'out/THIRD-PARTY-NOTICES.txt',
  title: 'Lowline — third-party notices',
  npm: { lock: '../package-lock.json', installedAt: '..' },
  /** The shell is built for Windows only (`bundle.targets`), so its crates are resolved for it. */
  cargo: { cwd: '../src-tauri', target: 'x86_64-pc-windows-msvc' },
  nuget: { assets: '../src-host/Lowline.Host/obj/project.assets.json' },
  pinned: { pins: 'pins.json', dir: 'texts' },
}
