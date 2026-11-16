// One version line for everything this repository publishes — `npx @iyulab/tauri-kit-dev versions --config versions.config.js
// [--bump <x.y.z>]` checks that the files agree, or moves them all at once (the changelog's Unreleased section
// released under it).
export default {
  files: [
    'Cargo.toml', // [workspace.package] — both crates take it
    { file: 'Cargo.lock', package: 'lowline' },
    { file: 'Cargo.lock', package: 'lowline-ffi' },
    'bindings/csharp/Directory.Build.props', // Lowline, Lowline.Sqlite, Lowline.Extensions.AI
    'bindings/web/package.json',
    'bindings/web/package-lock.json',
    'CHANGELOG.md', // its newest release heading; `--bump` releases the Unreleased section under the new one
  ],
}
