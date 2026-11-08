# folio-render

Host-side **read-only** PDF render/text service for Folio. Not an
`ignition_core::Engine`: no `EngineKind`, no `Command`/`Journal`, no
`NFD1` snapshot, no mutations. It is fed serialized PDF bytes (the
`folio-engine` `save`/`open` output) and answers `open`, `renderPage`,
`textPage`, `search`, `pageInfo`, `close`, `describe` over a
stdin/stdout JSON-lines protocol (same wire shape as `nf-cli`).

Backend: **pdfium** (the Chrome PDF engine) via `pdfium-render` 0.9.5,
runtime-bound (`dlopen`-style) — the crate compiles everywhere; the
native library is supplied per host. hayro remains an unimplemented,
feature-gated hedge for a later slice (WASM/pure-Rust fallback).

Admission record: `docs/completion/reports/P15-folio-render-admission.md`.
Op contract: same record §5. Bounds are fail-closed and enforced in
`src/lib.rs`: input ≤ 64 MiB, ≤ 4096 pages, render ≤ 4096 px/side and
≤ 32 MiB decoded RGBA, query ≤ 4096 chars, ≤ 100k text items, ≤ 1024
search hits/links per call.

## pdfium library location (never committed)

The pdfium shared library is a **third-party binary and is not in this
repository**. Resolution order (`src/pdfium.rs::resolve_pdfium_library_path`):

1. `$FOLIO_PDFIUM_LIBRARY` — full path to the library file.
2. `$FOLIO_PDFIUM_DIR/<name>` — directory containing the platform file.
3. `rust/folio-render/lib/<name>` — local drop-in (gitignored; do not commit).
4. Bare `<name>` via the OS loader search path.

Platform file names: `libpdfium.dylib` (macOS), `libpdfium.so`
(Linux/Android), `pdfium.dll` (Windows).

### Dev host (macOS arm64 — the only verified target)

```bash
# one-time: fetch the pinned prebuilt binary (see provenance below)
curl -L -o /tmp/pdfium-mac-arm64.tgz \
  https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8138/pdfium-mac-arm64.tgz
mkdir -p /tmp/folio-pdfium && tar xzf /tmp/pdfium-mac-arm64.tgz -C /tmp/folio-pdfium

# point the service at it
export FOLIO_PDFIUM_LIBRARY=/tmp/folio-pdfium/lib/libpdfium.dylib
cargo build -p folio-render
cargo test -p folio-render   # real pdfium tests run when the lib resolves
```

### Provenance / checksums (chromium/8138)

- Source: `bblanchon/pdfium-binaries` release tag `chromium/8138`,
  artifact `pdfium-mac-arm64.tgz` → pdfium **159.0.8138.0**
  (`VERSION`: MAJOR=159 MINOR=0 BUILD=8138 PATCH=0).
- Tarball SHA-256:
  `21a1567b397b571f4f77f21ca91eac7b892774219c3c715a5127a20950ccb18b`
- Extracted `lib/libpdfium.dylib` SHA-256:
  `626077b6d77845796aef2fff15049cdab0c176b4531433f090cfcbab4de1db59`
- `pdfium-render` crate feature pin is `pdfium_8125` (its newest
  bindings generation); it loads the 8138 dylib because binding is by
  symbol name at run time and the FPDF API is backward compatible.
- License: BSD-3-Clause (`LICENSES/pdfium.txt` + `LICENSES/pdfium-LICENSE`)
  plus per-dependency notices in `LICENSES/` — required verbatim in any
  binary distribution. See admission record §6.

## Platform status (honest)

| Target | Status |
|---|---|
| macOS arm64 dev host | **RUN** — open/renderPage/textPage/search/pageInfo verified |
| macOS x64, iOS, Android, Linux, Windows | NOT-RUN (upstream prebuilt artifacts exist) |
| WASM | NOT-RUN — pdfium Emscripten build unverified; hayro hedge not started |

Cancellation: none mid-render in this slice — the host processes one
frame at a time; a wedged render blocks the worker until it returns.

## Usage (library)

```rust
use folio_render::RenderService;
let mut svc = RenderService::new();
let info = svc.open(pdf_bytes, None)?; // {handle, pages, page_sizes, encrypted}
// remaining ops go through `svc.handle_frame(&FrameRequest { .. })`
// or, for hosts, the `folio-render` binary / `@nitro-forge/folio/render`.
```

TS adapter: `@nitro-forge/folio/render` (`FolioRenderService`), which
spawns the `folio-render` binary. `FOLIO_DEFERRED_OPS` in
`src/office-cluster.ts` no longer lists `renderPage`/`textPositions` —
they are served by this service, not the engine.
