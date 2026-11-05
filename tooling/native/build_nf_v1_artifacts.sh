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
#   NF_ANDROID_ABIS    comma-separated Android ABIs (default arm64-v8a). Pass
#                      the same list the app passes as reactNativeArchitectures;
#                      CMake fails for any ABI without an archive.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAB="$ROOT/packages/ignition-v1-lab"
ARCH="${1:?Specify android or apple}"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
HEADER="$ROOT/rust/nf-sys/include/nf_v1.h"
# The C++ session calls exactly these; the list lives in nf_v1_symbols.txt.
REQUIRED_SYMBOLS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] || REQUIRED_SYMBOLS+=("$line")
done <"$ROOT/tooling/native/nf_v1_symbols.txt"
[[ ${#REQUIRED_SYMBOLS[@]} -gt 0 ]] || { echo "No symbols in nf_v1_symbols.txt" >&2; exit 1; }

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
    IFS=',' read -r -a ABIS <<<"${NF_ANDROID_ABIS:-arm64-v8a}"
    NM="$(find "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt" -path '*/bin/llvm-nm' | head -1)"
    [[ -x "$NM" ]] || { echo "llvm-nm not found under $ANDROID_NDK_HOME" >&2; exit 1; }
    for abi in "${ABIS[@]}"; do
      case "$abi" in
        arm64-v8a) rust_target=aarch64-linux-android ;;
        armeabi-v7a) rust_target=armv7-linux-androideabi ;;
        x86_64) rust_target=x86_64-linux-android ;;
        x86) rust_target=i686-linux-android ;;
        *) echo "Unsupported Android ABI: $abi" >&2; exit 1 ;;
      esac
      rustup target add "$rust_target"
      (cd "$ROOT" && CARGO_TARGET_DIR="$TARGET_DIR" cargo ndk --target "$abi" \
        --platform "$API" build --manifest-path "$MANIFEST" --package nf-sys \
        --release --locked)
      # cargo-ndk -o copies shared .so libraries, not the static .a CMake needs.
      mkdir -p "$LAB/native/android/$abi"
      cp "$TARGET_DIR/$rust_target/release/libnf_sys.a" "$LAB/native/android/$abi/libnf_sys.a"
      verify_archive "$NM" "$LAB/native/android/$abi/libnf_sys.a"
    done
    ;;
  apple)
    command -v xcodebuild >/dev/null || { echo "Xcode required" >&2; exit 1; }
    # A generic iOS Simulator build compiles arm64 and x86_64, so the simulator
    # slice is a fat archive of both; the device slice is arm64 only.
    rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
    for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
      (cd "$ROOT" && CARGO_TARGET_DIR="$TARGET_DIR" IPHONEOS_DEPLOYMENT_TARGET=16.0 \
        cargo build --manifest-path "$MANIFEST" --package nf-sys --release \
        --locked --target "$target")
      verify_archive "$(xcrun --find nm)" "$TARGET_DIR/$target/release/libnf_sys.a"
    done
    SIM="$TARGET_DIR/apple-simulator-universal/libnf_sys.a"
    mkdir -p "$(dirname "$SIM")"
    lipo -create -output "$SIM" \
      "$TARGET_DIR/aarch64-apple-ios-sim/release/libnf_sys.a" \
      "$TARGET_DIR/x86_64-apple-ios/release/libnf_sys.a"
    sim_archs="$(lipo -archs "$SIM" | tr ' ' '\n' | sort | tr '\n' ' ')"
    [[ "$sim_archs" == "arm64 x86_64 " ]] || {
      echo "Simulator archive has architectures '$sim_archs', expected arm64 x86_64" >&2; exit 1;
    }
    OUT="$LAB/native/apple/NitroForgeRust.xcframework"
    rm -rf "$OUT"
    mkdir -p "$(dirname "$OUT")"
    xcodebuild -create-xcframework \
      -library "$TARGET_DIR/aarch64-apple-ios/release/libnf_sys.a" \
      -headers "$LAB/native/include" \
      -library "$SIM" \
      -headers "$LAB/native/include" \
      -output "$OUT"
    # Check the slices that SwiftPM will actually link, not only the inputs.
    # A fat slice is checked per architecture, so a symbol missing from one
    # architecture cannot hide behind the other.
    found=0
    THIN="$TARGET_DIR/apple-slice-check"
    while IFS= read -r slice; do
      for arch in $(lipo -archs "$slice"); do
        rm -rf "$THIN" && mkdir -p "$THIN"
        if [[ $(lipo -archs "$slice" | wc -w) -gt 1 ]]; then
          lipo "$slice" -thin "$arch" -output "$THIN/libnf_sys.a"
        else
          cp "$slice" "$THIN/libnf_sys.a"
        fi
        echo "Slice $slice ($arch):"
        verify_archive "$(xcrun --find nm)" "$THIN/libnf_sys.a"
      done
      found=$((found + 1))
    done < <(find "$OUT" -name 'libnf_sys.a')
    rm -rf "$THIN"
    [[ $found == 2 ]] || { echo "Expected 2 xcframework slices, found $found" >&2; exit 1; }
    ;;
  *)
    echo "Expected android or apple" >&2
    exit 1
    ;;
esac
