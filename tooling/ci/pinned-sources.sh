#!/usr/bin/env bash
# Fetches, verifies and unpacks the pinned third-party inputs that CI needs
# but the repository does not commit. Used by .github/workflows/ci.yml.
#
# Usage: tooling/ci/pinned-sources.sh <cache-dir> <item>...
#   items:
#     libraw       LibRaw source tarball for rust/nf-raw. Unpacked under
#                  target/ci-libraw and exported as NF_RAW_LIBRAW_DIR, which
#                  rust/nf-raw/build.rs builds in place instead of downloading
#                  from libraw.org.
#     pdfium       pdfium shared library for rust/folio-render (Linux x64).
#                  Exported as FOLIO_PDFIUM_LIBRARY.
#     raw-fixture  CC0 Pentax K-7 DNG for the raw-decode e2e tests.
#                  Exported as NF_RAW_TEST_FIXTURE.
#
# Every download is checked against its SHA-256 before use. A file already in
# <cache-dir> with the right hash is reused without network access, so a
# restored CI cache makes the run independent of the upstream hosts.
#
# Environment variables go to $GITHUB_ENV when it is set; otherwise they are
# printed as `export` lines, so locally: eval "$(tooling/ci/pinned-sources.sh ...)".
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
manifest="$repo_root/tooling/raw-prototype/manifest.json"

# pdfium: bblanchon/pdfium-binaries chromium/8138, the release that
# rust/folio-render/README.md pins for macOS arm64 (pdfium 159.0.8138.0).
PDFIUM_URL="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8138/pdfium-linux-x64.tgz"
PDFIUM_SHA256="d6b1e28950a0392590d79bbdbb7eb19686872b688f8a36f170acb19e41473113"
PDFIUM_LIB_SHA256="655e831208783f38dc187ad424bdfdae39858cfbfcf3a9a2cb9dd0694b5abcad"

log() { echo "pinned-sources: $*" >&2; }

export_env() {
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "$1=$2" >> "$GITHUB_ENV"
  else
    printf 'export %s=%q\n' "$1" "$2"
  fi
  log "$1=$2"
}

sha_ok() { echo "$2  $1" | sha256sum --check --status --strict 2>/dev/null; }

# fetch <url> <sha256> <dest>
fetch() {
  local url=$1 sha=$2 dest=$3
  if [ -f "$dest" ] && sha_ok "$dest" "$sha"; then
    log "reusing $(basename "$dest") (sha256 verified)"
    return
  fi
  log "downloading $url"
  rm -f "$dest.part"
  curl --fail --location --silent --show-error \
    --retry 4 --retry-all-errors --retry-delay 5 --connect-timeout 30 \
    --max-filesize 67108864 -o "$dest.part" "$url"
  if ! sha_ok "$dest.part" "$sha"; then
    log "SHA-256 mismatch for $url: got $(sha256sum "$dest.part" | cut -d' ' -f1), want $sha"
    rm -f "$dest.part"
    exit 1
  fi
  mv "$dest.part" "$dest"
}

if [ $# -lt 2 ]; then
  echo "usage: $0 <cache-dir> libraw|pdfium|raw-fixture..." >&2
  exit 2
fi
# Accept a literal leading ~ (the workflow passes the same path actions/cache uses).
cache_dir="${1/#\~/$HOME}"
shift
mkdir -p "$cache_dir"
cache_dir="$(cd "$cache_dir" && pwd)"

for item in "$@"; do
  case "$item" in
    libraw)
      version=$(jq -er '.source.version' "$manifest")
      url=$(jq -er '.source.url' "$manifest")
      sha=$(jq -er '.source.sha256' "$manifest")
      # build.rs carries its own copy of the pin; refuse to run if they drift.
      build_rs="$repo_root/rust/nf-raw/build.rs"
      grep -q "\"$sha\"" "$build_rs" || { log "rust/nf-raw/build.rs LibRaw SHA-256 differs from $manifest"; exit 1; }
      grep -q "LIBRAW_VERSION: &str = \"$version\"" "$build_rs" || { log "rust/nf-raw/build.rs LibRaw version differs from $manifest"; exit 1; }
      tarball="$cache_dir/LibRaw-$version.tar.gz"
      fetch "$url" "$sha" "$tarball"
      # Unpacked inside target/ so a restored cargo target cache and the
      # LibRaw tree it was linked against stay together; build.rs builds
      # lib/libraw_r.a in place and skips make when it is already there.
      root="$repo_root/target/ci-libraw"
      src="$root/LibRaw-$version"
      if [ ! -f "$src/libraw/libraw.h" ]; then
        mkdir -p "$root"
        tar -xzf "$tarball" -C "$root"
      fi
      export_env NF_RAW_LIBRAW_DIR "$src"
      ;;
    pdfium)
      tarball="$cache_dir/pdfium-linux-x64-8138.tgz"
      fetch "$PDFIUM_URL" "$PDFIUM_SHA256" "$tarball"
      dir="${RUNNER_TEMP:-$cache_dir}/pdfium-8138"
      if [ ! -f "$dir/lib/libpdfium.so" ]; then
        mkdir -p "$dir"
        tar -xzf "$tarball" -C "$dir"
      fi
      sha_ok "$dir/lib/libpdfium.so" "$PDFIUM_LIB_SHA256" || { log "libpdfium.so SHA-256 mismatch"; exit 1; }
      export_env FOLIO_PDFIUM_LIBRARY "$dir/lib/libpdfium.so"
      ;;
    raw-fixture)
      url=$(jq -er '.fixture.url' "$manifest")
      sha=$(jq -er '.fixture.sha256' "$manifest")
      dest="$cache_dir/pentax-k7-$sha.dng"
      fetch "$url" "$sha" "$dest"
      export_env NF_RAW_TEST_FIXTURE "$dest"
      ;;
    *)
      echo "unknown item: $item" >&2
      exit 2
      ;;
  esac
done
