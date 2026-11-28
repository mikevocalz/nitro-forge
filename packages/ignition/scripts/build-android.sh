#!/usr/bin/env bash
set -euo pipefail
PACKAGE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$PACKAGE/../.." && pwd)
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to the same NDK used by the Expo app}"
# Requires cargo-ndk and the requested Rust targets. Includes arm64 Meta Quest.
#
# Engines: NF_ENGINES=prism,tally (or "all"), else the nitroForge.engines
# property in $NF_APP_ROOT/android/gradle.properties (written by the config
# plugin's engines option at prebuild), else every engine. See
# scripts/resolve-engines.cjs. The list is recorded in engines.txt next to
# each archive; android/forge-engines.cmake checks it at configure time.
ENGINES=$(node "$PACKAGE/scripts/resolve-engines.cjs" android list)
read -r -a FEATURES <<< "$(node "$PACKAGE/scripts/resolve-engines.cjs" android cargo)"
echo "nf-sys engines: $ENGINES"
ABIS=("$@")
if [[ $# -eq 0 ]]; then ABIS=(armeabi-v7a arm64-v8a x86 x86_64); fi
for abi in "${ABIS[@]}"; do
  case "$abi" in
    arm64-v8a) target=aarch64-linux-android ;;
    x86_64) target=x86_64-linux-android ;;
    armeabi-v7a) target=armv7-linux-androideabi ;;
    x86) target=i686-linux-android ;;
    *) echo "Unsupported Android ABI: $abi" >&2; exit 1 ;;
  esac
  (cd "$ROOT" && cargo ndk -t "$abi" --platform 24 build --locked --release -p nf-sys ${FEATURES[@]+"${FEATURES[@]}"})
  mkdir -p "$PACKAGE/native/android/$abi"
  cp "${CARGO_TARGET_DIR:-$ROOT/target}/$target/release/libnf_sys.a" "$PACKAGE/native/android/$abi/"
  printf '%s\n' "$ENGINES" > "$PACKAGE/native/android/$abi/engines.txt"
done
