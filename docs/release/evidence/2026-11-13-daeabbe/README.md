# F3 merge and review-fix checks

Captured 2026-11-13 on macOS arm64, Node v26.13.0 and cargo 1.99.1.
Source revision: `daeabbee6c331c02b3d9c9fc23686151c1dd932f`.
This receipt was added afterward; it covers that source revision.

## Merge

Merged master `dcb92fd25b51f2559b8a2b433f22ea8c024f9471` into the F3 branch
at `c83c87104d4001e031b94e296d702688f8f902a3`.

- Studio preview retains F3's source-test and engine-test scripts and Vitest
  5.1.0, with master's Vite 8.3.8 and Tailwind 4.3.5.
- Its lock importer uses the existing master Vitest/Vite 8.3.8 peer graph.
  The rest of the master lockfile is unchanged.
- Both historical ROSTER sections are retained. Master dependency, config,
  license and app-identity changes are included.

## Review fixes

1. Cancellation during analysis skips the marker write. Once `addMarkers`
   starts, the helper awaits its atomic result and reports the actual added
   count. The UI requests cancellation without claiming that nothing was
   written or undoing the accepted write. An in-flight failure still rejects.
2. Rename, note and duration changes compare the lane's rounded frame with
   the authoritative marker. They retain sub-frame ticks when position is
   unchanged. The regression uses 943 ticks, displayed as frame 15 at 30 fps,
   with the real callback's frame-derived 0.5 seconds.
3. Restore checks marker IDs are positive JavaScript-safe integers and sorts
   the decoded candidate by ticks and ID before committing. Invalid restore
   leaves the current document intact. Saves without markers still load.
4. Marker allocation rejects an exhausted or unsafe ID range before a
   journal entry or mutation. Tests include the last valid ID, a rejected
   two-marker batch, and undo/redo around the final successful allocation.

## Actual checks

| Command | Result | Output |
| --- | --- | --- |
| `node --test apps/studio-preview/src/*.test.ts` | 34 passed, 0 failed | [source-tests.log](source-tests.log) |
| `cargo test --locked --offline -p cadence-engine` | 78 passed, 0 failed, 0 ignored; 0 doc tests | [cadence-rust-tests.log](cadence-rust-tests.log) |
| `npx --yes pnpm@12.18.0 install --lockfile-only --frozen-lockfile --ignore-scripts --offline` | Passed for all 30 workspace projects | [frozen-lockfile.log](frozen-lockfile.log) |

The Cargo run used a task-local target directory with
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0` and
`CARGO_INCREMENTAL=0`. The resulting target occupied about 49 MiB; available
space stayed above the owner's 10 GiB floor. The compiler reported existing
unused-doc-comment and dead-code warnings. This is not a release build or a
performance measurement. Commands and exit codes are in [checks.json](checks.json).

## Contract and ownership notes

- `api-design`: the chosen option-B contracts remain those in
  `docs/proposals/F3-deferred-rows.md`. No new engine op or exported engine
  signature was added by these corrections. The internal marker update
  adapter now takes the authoritative marker and frame rate.
- `build-nitro-modules`: no HybridObject spec, C ABI signature or generated
  binding was changed. Local Nitrogen generation: NOT RUN. CI must run the
  existing codegen/diff step on this revision.
- `cpp`: no C++ change. Each engine remains a single-threaded `Send` state
  machine driven through its host's serial document queue. Restore validates
  a local decoded document before assignment; marker writes retain one
  whole-document journal entry. No lock or callback was added.
- `react-native-best-practices`: no optimization or frame-rate claim. The
  component keeps serializable state in Zustand and its AbortController in
  the existing imperative ref.
- `no-ai-slop`: cancellation copy now describes the actual write boundary.

## NOT RUN and remaining acceptance

Full workspace Rust tests, Tally/nf-sys suites, studio-preview TypeScript,
real nf-cli browser-row e2e tests, Nitrogen generation, browser rendering,
Argent on-screen proof, native iOS/Android and desktop were NOT RUN locally
for this revision. CI and independent review remain pending. PR #82's web
render fix remains separate and is a prerequisite for F3 on-screen acceptance.
No release gate, row acceptance or reviewer signature is promoted here.
