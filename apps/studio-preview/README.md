# Studio browser harness

This local development harness renders the shared native/web workspace against
the actual Rust engines. Build the CLI, install workspace dependencies and run:

```sh
cargo build --locked -p nf-cli
pnpm --filter @nitro-forge/studio-preview dev
```

Open http://127.0.0.1:4173. The app list opens only the app requested, at its own `#/apps/<app>` route.
Opened apps keep independent engine sessions while navigating the list; a page
reload closes those temporary sessions. There is no editor mode-switching strip.
Actions, undo/redo, refresh and downloaded NFD1 snapshots use `nf-cli` through
same-origin POST requests. Returning to the app list preserves each opened document for this browser session.
Documents are temporary unless a snapshot is downloaded.
Save layout writes a versioned preset to localStorage separately for each studio;
it loads again on reload. The light/dark toggle changes the shared workspace theme
without reopening the document or clearing engine history.
The Host width selector constrains the editor container to full width, 768px, 724px or
390px (clamped to available space), without changing the browser window or
reopening the engine. It supports measured responsive QA inside one browser tab.

With the server running, `pnpm --filter @nitro-forge/studio-preview test:bridge`
checks all seven engines through HTTP: mutation, undo/redo, snapshot/reopen and
rejection of cross-origin requests. `pnpm --filter @nitro-forge/studio-preview
typecheck` checks the harness and its shared workspace imports.
`pnpm --filter @nitro-forge/studio-preview test:integration` starts its own
loopback server on port 4185, runs that check and shuts the server down. Build
`nf-cli` first. `STUDIO_PREVIEW_URL` overrides the existing-server test URL.

The development bridge binds only to loopback and rejects cross-origin requests.
It is a local QA harness, not a production server or native-runtime substitute.
`vite build` validates browser bundling but requires this dev bridge for engine
operations; static hosting does not provide the Rust process.

Quill supplies an essay text area, Apply text, DOCX/NFD opening and Word export.
Save flushes the pending essay draft before creating its NFD snapshot. Word import
uses the real engine; the current DOCX subset remains the engine contract described
in ENGINE_OPS.md. The shared native example also supports the essay surface; native
file-picker integration remains a host responsibility.

The current visual pass uses the authored shared icon package, semantic RN theme
tokens and Tailwind v4 compilation. Workspace settings are in the menu; app entry
and document sessions remain independent. Source and reference notes live in
`docs/ux/DESIGN_REFERENCE_AUDIT.md`.

### Canonical Skia web runtime

The preview hosts the existing NYC UI Skia web wrappers. `skia-web-assets.mjs`
resolves CanvasKit through this host's pinned `react-native-skia` 3.9.1, serves
`/canvaskit/canvaskit.wasm` with the WASM MIME type in development and emits the
same binary for production builds. Vite aliases the canonical UI imports to that
same host installation; it never mixes the sibling checkout's Skia with host WASM. Vite resolves Skia's asset registry to React Native Web and
provides the canonical gate's root-path environment setting. A custom deployment
base requires matching the gate's asset prefix as well as Vite's base.

Run `node verify-skia-assets.mjs` and `node verify-skia-bundle.mjs` from this
folder. The latter bundles the real canonical Arrow web wrapper, gate and lazy
Skia drawing, then removes its generated fixture. These are asset/import checks,
not browser GPU pixels or a native engine integration. The canonical gate loads
CanvasKit before its drawing module; a network failure currently requires a page
reload and its shared error UI remains a separate canonical-package change.

Cross-platform reuse means shared component contracts, themes and scene/input
models with platform adapters: CanvasKit/WebGL in browsers, Skia Graphite on
supported iOS/Android hardware, and separately validated spatial surface/input
adapters on Meta headsets. Browser builds do not validate Quest/Viro surfaces or
controller/hand/pen behavior. Skia initialization is independent of the Rust
engine host: this loopback preview is not a browser-WASM engine implementation.

The SDK58/latest candidate is blocked for Expo/Metro exports and fresh-package
release-age checks. See `../../docs/native/SDK58_METRO_UPGRADE.md`. The preview
aliases canonical Skia imports and CanvasKit to the same host3.9.1 installation;
SVG assets use the existing React Native Web asset registry.
