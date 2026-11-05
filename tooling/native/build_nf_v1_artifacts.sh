#!/usr/bin/env bash
set -euo pipefail

# Run from the Nitro Forge monorepo on the actual platform build runner.
# Build actual nf-sys archives. Never accept empty/placeholder native archives.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAB="$ROOT/packages/ignition-v1-lab"
ARCH="${1:?Specify android or apple}"

if [[ ! -f "$ROOT/rust/nf-sys/include/nf_v1.h" ]]; then
  echo "Missing v1 Rust C header. Use the stacked v1 FFI branch." >&2
  exit 1
fi

cp "$ROOT/rust/nf-sys/include/nf_v1.h" "$LAB/cpp/nf_v1.h"
mkdir -p "$LAB/native/include"
cp "$ROOT/rust/nf-sys/include/nf_v1.h" "$LAB/native/include/nf_v1.h"
MANIFEST="$ROOT/Cargo.toml"

case "$ARCH" in
  android)
    command -v cargo-ndk >/dev/null || {
      echo "Install cargo-ndk first (cargo install cargo-ndk --locked)." >&2; exit 1;
    }
    : "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must point to an installed Android NDK}"
    rustup target add aarch64-linux-android
    cargo ndk --target arm64-v8a --output "$LAB/native/android" \
      build --manifest-path "$MANIFEST" --package nf-sys --release
    test -s "$LAB/native/android/arm64-v8a/libnf_sys.a"
    echo "Real Android arm64 Rust static library built."
    ;;
  apple)
    command -v xcodebuild >/dev/null || { echo "Xcode required" >&2; exit 1; }
    rustup target add aarch64-apple-ios aarch64-apple-ios-sim
    cargo build --manifest-path "$MANIFEST" --package nf-sys --release \
      --target aarch64-apple-ios
    cargo build --manifest-path "$MANIFEST" --package nf-sys --release \
      --target aarch64-apple-ios-sim
    OUT="$LAB/native/apple/NitroForgeRust.xcframework"
    rm -rf "$OUT"
    mkdir -p "$(dirname "$OUT")"
    xcodebuild -create-xcframework \
      -library "$ROOT/target/aarch64-apple-ios/release/libnf_sys.a" \
      -headers "$LAB/native/include" \
      -library "$ROOT/target/aarch64-apple-ios-sim/release/libnf_sys.a" \
      -headers "$LAB/native/include" \
      -output "$OUT"
    test -d "$OUT" || { echo "Missing real Rust XCFramework" >&2; exit 1; }
    echo "Real Apple device/simulator Rust static XCFramework built."
    ;;
  *)
    echo "Expected android or apple" >&2
    exit 1
    ;;
esac
