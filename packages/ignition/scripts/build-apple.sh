#!/usr/bin/env bash
set -euo pipefail
PACKAGE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$PACKAGE/../.." && pwd)
# Requires macOS/Xcode and all three iOS Rust targets below.
# Supports arm64 iPhones and a universal arm64/x86_64 simulator slice.
#
# Engines: NF_ENGINES=prism,tally (or "all"), else the nitroForge.engines key
# in $NF_APP_ROOT/ios/Podfile.properties.json (written by the config plugin's
# engines option at prebuild), else every engine. See
# scripts/resolve-engines.cjs. The list is recorded in
# native/ForgeRust.engines.txt next to the XCFramework.
ENGINES=$(node "$PACKAGE/scripts/resolve-engines.cjs" apple list)
read -r -a FEATURES <<< "$(node "$PACKAGE/scripts/resolve-engines.cjs" apple cargo)"
echo "nf-sys engines: $ENGINES"
for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
  (cd "$ROOT" && IPHONEOS_DEPLOYMENT_TARGET=16.0 cargo build --locked --release -p nf-sys --target "$target" ${FEATURES[@]+"${FEATURES[@]}"})
done
mkdir -p "$PACKAGE/native"
OUT="$PACKAGE/native/ForgeRust.xcframework"
if [[ -e "$OUT" ]]; then echo "Remove the previous generated $OUT before rebuilding" >&2; exit 1; fi
SIMULATOR="$PACKAGE/native/ios-simulator"
mkdir -p "$SIMULATOR"
lipo -create \
  "${CARGO_TARGET_DIR:-$ROOT/target}/aarch64-apple-ios-sim/release/libnf_sys.a" \
  "${CARGO_TARGET_DIR:-$ROOT/target}/x86_64-apple-ios/release/libnf_sys.a" \
  -output "$SIMULATOR/libnf_sys.a"
sim_archs=$(lipo "$SIMULATOR/libnf_sys.a" -archs)
[[ " $sim_archs " == *" arm64 "* && " $sim_archs " == *" x86_64 "* ]] || { echo "Missing simulator architecture: $sim_archs" >&2; exit 1; }
xcodebuild -create-xcframework \
  -library "${CARGO_TARGET_DIR:-$ROOT/target}/aarch64-apple-ios/release/libnf_sys.a" -headers "$ROOT/rust/nf-sys/include" \
  -library "$SIMULATOR/libnf_sys.a" -headers "$ROOT/rust/nf-sys/include" \
  -output "$OUT"
printf '%s\n' "$ENGINES" > "$PACKAGE/native/ForgeRust.engines.txt"
