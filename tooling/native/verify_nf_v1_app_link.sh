#!/usr/bin/env bash
set -euo pipefail

# Proves a built iOS app linked the Rust C ABI: every symbol in
# nf_v1_symbols.txt must be defined (T) in the app's code binary, in every
# architecture it was built for. Exits non-zero on any missing symbol.
#
# tooling/native/verify_nf_v1_app_link.sh <path/to/App.app>
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${1:?Pass the built .app directory}"
[[ -d "$APP" ]] || { echo "No app bundle at $APP" >&2; exit 1; }
NAME="$(basename "$APP" .app)"
# Debug builds put the app's code in <Name>.debug.dylib and leave a stub
# executable; Release builds link it into the executable itself.
BINARY="$APP/$NAME.debug.dylib"
[[ -f "$BINARY" ]] || BINARY="$APP/$NAME"
[[ -f "$BINARY" ]] || { echo "No app binary in $APP" >&2; exit 1; }

symbols=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] || symbols+=("$line")
done <"$ROOT/tooling/native/nf_v1_symbols.txt"

missing=0
for arch in $(lipo -archs "$BINARY"); do
  defined="$(nm -U -arch "$arch" "$BINARY")"
  found=()
  for sym in "${symbols[@]}"; do
    if grep -Eq " T _${sym}$" <<<"$defined"; then
      found+=("$sym")
    else
      echo "$BINARY ($arch) does not define $sym" >&2
      missing=1
    fi
  done
  echo "Linked ${#found[@]}/${#symbols[@]} nf_v1 symbols into $(basename "$BINARY") ($arch): ${found[*]}"
done
exit "$missing"
