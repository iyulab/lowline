// The files Lowline writes its version in — `npm run versions` checks they agree, `-- --bump <x.y.z>` moves them together.
export default {
  files: [
    'src-tauri/Cargo.toml',
    { file: 'src-tauri/Cargo.lock', package: 'lowline' },
    'src-tauri/tauri.conf.json',
    'package.json',
    'package-lock.json',
  ],
}
