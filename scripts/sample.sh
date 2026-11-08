#!/usr/bin/env bash
# Builds the engine, the element and the reference host, then starts the host.
#
#   scripts/sample.sh                 # http://localhost:5180
#   URL=http://localhost:6000 scripts/sample.sh
#
# Extra arguments go to the host (after `--`).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

cargo build -p lowline-ffi
(cd bindings/web && { [ -d node_modules ] || npm ci; } && npm run bundle)
exec dotnet run --project samples/aspnet --urls "${URL:-http://localhost:5180}" -- "$@"
