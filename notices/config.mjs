// The third-party notices the NuGet package `Lowline` carries for its native library: the crates statically linked
// into `lowline_native` (crate `lowline-ffi`). Its dependencies are the same on every runtime it is built for.
// Written by the release build (`npx @iyulab/tauri-kit-dev notices --config notices/config.mjs --strict`).
export default {
  out: '../bindings/csharp/Lowline/THIRD-PARTY-NOTICES.txt',
  title: 'Lowline native library — third-party notices',
  cargo: { cwd: '../crates/lowline-ffi', target: 'x86_64-unknown-linux-gnu' },
}
