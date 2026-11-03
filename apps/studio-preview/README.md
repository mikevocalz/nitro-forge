# Studio browser harness

This local development harness renders the shared native/web workspace against
the actual Rust engines. Build the CLI, install workspace dependencies and run:

```sh
cargo build --locked -p nf-cli
pnpm --filter @nitro-forge/studio-preview dev
```

Open http://127.0.0.1:4173. The seven studio tabs each open an engine document.
Actions, undo/redo, refresh and downloaded NFD1 snapshots use `nf-cli` through
same-origin POST requests. Switching studio closes its previous document.
Documents are temporary unless a snapshot is downloaded.
Save layout writes a versioned preset to localStorage separately for each studio;
it loads again on reload. The light/dark toggle changes the shared workspace theme
without reopening the document or clearing engine history.
The Host width selector constrains the editor container to full width, 768px or
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
