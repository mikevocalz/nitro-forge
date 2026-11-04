#!/usr/bin/env bash
set -euo pipefail
PACKAGE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$PACKAGE/../.." && pwd)
# Requires macOS/Xcode and Rust targets aarch64-apple-ios and aarch64-apple-ios-sim.
# Supports arm64 iPhones and Apple Silicon simulators.
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  (cd "$ROOT" && IPHONEOS_DEPLOYMENT_TARGET=16.0 cargo build --locked --release -p nf-sys --target "$target")
done
mkdir -p "$PACKAGE/native"
OUT="$PACKAGE/native/ForgeRust.xcframework"
if [[ -e "$OUT" ]]; then echo "Remove the previous generated $OUT before rebuilding" >&2; exit 1; fi
xcodebuild -create-xcframework \
  -library "${CARGO_TARGET_DIR:-$ROOT/target}/aarch64-apple-ios/release/libnf_sys.a" -headers "$ROOT/rust/nf-sys/include" \
  -library "${CARGO_TARGET_DIR:-$ROOT/target}/aarch64-apple-ios-sim/release/libnf_sys.a" -headers "$ROOT/rust/nf-sys/include" \
  -output "$OUT"
