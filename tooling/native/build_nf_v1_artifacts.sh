#!/usr/bin/env bash
set -euo pipefail

# Builds the nf-sys static archives that the Android CMake target and the
# SwiftPM binaryTarget link. Every archive must define the nf_v1_* entry
# points that cpp/ForgeRustSession.cpp calls; an archive without them fails.
#
# Environment:
#   CARGO_TARGET_DIR   shared cargo output dir (default: <repo>/target)
#   ANDROID_NDK_HOME   NDK used by the app (android only)
#   NF_ANDROID_API     API level the Rust archive targets (default 24, the
#                      React Native 0.88 floor; must not exceed the app minSdk)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAB="$ROOT/packages/ignition-v1-lab"
ARCH="${1:?Specify android or apple}"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
HEADER="$ROOT/rust/nf-sys/include/nf_v1.h"
# The C++ session calls exactly these; keep in sync with ForgeRustSession.cpp.
REQUIRED_SYMBOLS=(nf_v1_open nf_v1_apply_parts nf_v1_snapshot nf_v1_restore
  nf_v1_close nf_v1_free_command_result)

if [[ ! -f "$HEADER" ]]; then
  echo "Missing v1 Rust C header $HEADER. Use the stacked v1 FFI branch." >&2
  exit 1
fi

cp "$HEADER" "$LAB/cpp/nf_v1.h"
mkdir -p "$LAB/native/include"
cp "$HEADER" "$LAB/native/include/nf_v1.h"
MANIFEST="$ROOT/Cargo.toml"

# verify_archive <nm binary> <archive>
verify_archive() {
  local nm_bin="$1" archive="$2" defined missing=0
  test -s "$archive" || { echo "Empty or missing archive: $archive" >&2; exit 1; }
  defined="$("$nm_bin" --defined-only "$archive" 2>/dev/null || true)"
  for sym in "${REQUIRED_SYMBOLS[@]}"; do
    # Mach-O prefixes C symbols with an underscore; ELF does not.
    if ! grep -Eq " T _?${sym}$" <<<"$defined"; then
      echo "Archive $archive does not define $sym" >&2
      missing=1
    fi
  done
  [[ $missing == 0 ]] || exit 1
  echo "Verified ${#REQUIRED_SYMBOLS[@]} nf_v1_* symbols defined in $archive"
}

case "$ARCH" in
  android)
    command -v cargo-ndk >/dev/null || {
      echo "Install cargo-ndk first (cargo install cargo-ndk --locked)." >&2; exit 1;
    }
    : "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must point to an installed Android NDK}"
    API="${NF_ANDROID_API:-24}"
    rustup target add aarch64-linux-android
    (cd "$ROOT" && CARGO_TARGET_DIR="$TARGET_DIR" cargo ndk --target arm64-v8a \
      --platform "$API" build --manifest-path "$MANIFEST" --package nf-sys \
      --release --locked)
    # cargo-ndk -o copies shared .so libraries, not the static .a CMake needs.
    mkdir -p "$LAB/native/android/arm64-v8a"
    cp "$TARGET_DIR/aarch64-linux-android/release/libnf_sys.a" \
      "$LAB/native/android/arm64-v8a/libnf_sys.a"
    NM="$(find "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt" -path '*/bin/llvm-nm' | head -1)"
    [[ -x "$NM" ]] || { echo "llvm-nm not found under $ANDROID_NDK_HOME" >&2; exit 1; }
    verify_archive "$NM" "$LAB/native/android/arm64-v8a/libnf_sys.a"
    ;;
  apple)
    command -v xcodebuild >/dev/null || { echo "Xcode required" >&2; exit 1; }
    rustup target add aarch64-apple-ios aarch64-apple-ios-sim
    for target in aarch64-apple-ios aarch64-apple-ios-sim; do
      (cd "$ROOT" && CARGO_TARGET_DIR="$TARGET_DIR" IPHONEOS_DEPLOYMENT_TARGET=16.0 \
        cargo build --manifest-path "$MANIFEST" --package nf-sys --release \
        --locked --target "$target")
      verify_archive "$(xcrun --find nm)" "$TARGET_DIR/$target/release/libnf_sys.a"
    done
    OUT="$LAB/native/apple/NitroForgeRust.xcframework"
    rm -rf "$OUT"
    mkdir -p "$(dirname "$OUT")"
    xcodebuild -create-xcframework \
      -library "$TARGET_DIR/aarch64-apple-ios/release/libnf_sys.a" \
      -headers "$LAB/native/include" \
      -library "$TARGET_DIR/aarch64-apple-ios-sim/release/libnf_sys.a" \
      -headers "$LAB/native/include" \
      -output "$OUT"
    # Check the slices that SwiftPM will actually link, not only the inputs.
    found=0
    while IFS= read -r slice; do
      verify_archive "$(xcrun --find nm)" "$slice"
      found=$((found + 1))
    done < <(find "$OUT" -name 'libnf_sys.a')
    [[ $found == 2 ]] || { echo "Expected 2 xcframework slices, found $found" >&2; exit 1; }
    ;;
  *)
    echo "Expected android or apple" >&2
    exit 1
    ;;
esac
