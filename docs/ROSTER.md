# Nitro-Forge Task Roster

Living ledger per the project operating standard. "Evidence" means a command whose
output actually exists; anything not executed is marked NOT RUN.

## Verified — evidence exists

| Check | Result | Command |
|---|---|---|
| ignition-core contract tests | 5 pass | `cargo test -p ignition-core` |
| prism-engine unit tests | 55 pass | `cargo test -p prism-engine` |
| tally-engine unit + formula tests | 27 pass | `cargo test -p tally-engine` |
| cadence-engine tests (incl. real PCM render) | 21 pass | `cargo test -p cadence-engine` |
| splice-engine tests | 16 pass | `cargo test -p splice-engine` |
| folio-engine tests (real PDF round-trip via lopdf) | 17 pass | `cargo test -p folio-engine` |
| pitch-engine tests (animation timing) | 17 pass | `cargo test -p pitch-engine` |
| quill-engine tests (incl. real DOCX zip round-trip) | 25 pass | `cargo test -p quill-engine` |
| nf-sys C FFI round-trip test | 1 pass | `cargo test -p nf-sys` |
| Package e2e suites (vitest → nf-cli → real Rust) | 4×8 = 32 pass | `pnpm -r test` |
| Console workflow demo (all 7 products, create→edit→save→reopen) | 14/14 checks | `pnpm --filter @nitro-forge/console demo` |
| Typecheck: ignition + 7 product packages + apps/console + apps/example | clean | `pnpm -r exec tsc --noEmit` |
| Post-review full workspace retest | 184 Rust + 32 vitest pass | `cargo test --workspace && pnpm -r test` |

## Transport status

| Transport | Status |
|---|---|
| nf-cli JSON-lines | ✅ verified — powers all e2e suites |
| nf-sys C ABI (staticlib/cdylib) | ✅ verified — FFI round-trip test passes |
| Nitro HybridObject codegen (nitrogen) | ⚠️ spec written (`Forge.nitro.ts` + `nitro.json`); codegen NOT run |
| iOS / Android / WASM builds | ❌ NOT RUN |
| apps/example on simulator/device | ❌ NOT RUN |

## Workstreams

| Workstream | Role | Task | Status |
|---|---|---|---|
| Ignition contracts | Architect (main session) | ARCHITECTURE.md, ignition-core, protocol, envelope, journal, registry | ✅ verified |
| C FFI | Platform eng (main session) | nf-sys | ✅ verified (1 test) |
| TS host/DX | API eng (main session) | EngineHost/NitroHost/CliHost/DocumentHandle, 7 typed APIs | ✅ verified via e2e |
| Prism engine | Graphics eng (subagent 3ba36e7a) | layers, pixels, filters, flatten | ✅ 55 tests |
| Tally engine | Spreadsheet eng (subagent ddf87203) | formula parser/evaluator | ✅ 27 tests |
| Cadence engine | Audio/DSP eng (subagent 75836ea5) | MIDI clips, transport, PCM render | ✅ 21 tests |
| Splice engine | Video systems eng (subagent 75836ea5) | timeline, split/trim/speed | ✅ 16 tests |
| Folio engine | PDF eng (subagent bdd8014e) | lopdf parse/annotate/save | ✅ 17 tests |
| Pitch engine | Presentation eng (subagent bdd8014e) | slides, objects, animation resolve | ✅ 17 tests |
| Quill engine | Text/layout eng (subagent fa0fd913) | blocks/styles/layout + DOCX | ✅ 25 tests |
| Independent review | Reviewer (subagent 3cb4c8fe) | FFI safety, engine spot-checks, TS protocol | ✅ 23 findings; 16 fixed + retested |
| Example app | RN eng (main session) | Expo screens + useDocument hook | ⚠️ source + typecheck only |
| Design/UX | — | — | ❌ not staffed this session |
| AI workstream | — | — | ❌ not started (engines are provider-free as required) |
| Performance budgets | — | — | ❌ unmeasured; no perf claims made |

## Independent review — findings & resolution (subagent 3cb4c8fe)

Reviewer reproduced three defects live (nf-cli + a C harness against
`libnf_sys.dylib`). Fixed and retested:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | nf-sys mutex poisoning → process abort on engine panic | Critical | `reg_lock()` recovers poisoned registry at every lock site |
| 2 | nf_snapshot/nf_restore/nf_close lacked `catch_unwind` | Critical | all extern fns now panic-guarded; panic closes the session |
| 3 | nf_free_bytes assumed Vec cap == len (latent UB) | Major | snapshot hands out `Box<[u8]>`; freed as slice, capacity-free |
| 4 | cadence u64 `start+len` overflow panics on crafted input | Major | saturating/checked arithmetic at end_ticks, overlaps, addNote, resizeClip, render |
| 5 | folio `page as u32 + 1` overflow/truncation aliased pages | Major | `u32::try_from` + `checked_add` → OutOfBounds |
| 6 | NitroHost.apply ignored `{"ok":false}` → silent success | Major | throws EngineError on `ok === false` |
| 7 | CliHost: no `error` handler on proc/stdin (ENOENT crash) | Major | `killAll` rejects all pending on error/exit/parse failure |
| 8 | CliHost UTF-8 corruption at pipe chunk boundaries | Major | `StringDecoder` accumulation |
| 9 | folio journal recorded before fallible work | Major | add/removeAnnotation validate destination + existence first |
| 10 | prism restore skipped MAX_PIXELS ceiling | Major | `check_dims` enforced on restore |
| 12 | envelope: unknown format → `Unsupported` not `Serialization` | Minor | spec-aligned; 4 GiB assert added to encode |
| 13 | nf_apply didn't route `__snapshot` | Minor | routed, parity with run_stdio |
| 14 | `*out_err` dereferenced unconditionally | Minor | `set_err` null-checks every write |
| 15 | tally restore accepted unreachable cell keys/dup sheets | Minor | keys normalized via parse/fmt_addr; dup id/name rejected |
| 16 | cadence setTimeSig `as u32` truncation | Minor | bounds-checked (d ≤ 128, n ≤ u32::MAX) |
| 17 | cadence/splice restore could reuse ids | Minor | next_id clamped past max live id |
| 18 | prism drawPixels fractional x/y + event on no-op | Minor | integral coords required; off-canvas emits no event |
| 20 | quill import_docx unbounded decompression | Minor | 256 MiB cap on document.xml |
| 21 | DocumentHandle.emit: listener throw failed apply | Minor | listener errors rethrown via queueMicrotask |
| 22 | CliHost pending leak + URL.pathname | Minor | pending deleted on write error; `fileURLToPath` |
| 23 | unparseable frame answered id:0 → caller hangs | Minor | best-effort `extract_frame_id` |

**Deferred (documented, not fixed):**
- #11 base64 decoders accept non-canonical input (`len%4==1`, stray `=`) —
  leniency is consistent across Rust+TS decoders; tighten if a strict consumer
  appears.
- #19 quill `deleteRange` boundary-block kind merge — behavior is
  self-consistent with `text()`'s newline-inclusive slicing; flagged for
  product-level confirmation rather than changed blindly.

## Known issues & honest limitations
- Three e2e test expectations were wrong vs. spec and were fixed post-review
  (`ZZ99` is a legal cell address; `addClip` defaults to track end; `blocks`
  returns `{blocks:[…]}`). Engines were correct; tests were not.
- Several engines carry a private base64 copy because the ignition-core
  re-export landed after they were written — `ignition_core::base64_*` now
  exists; dedupe is safe but deferred (tracked here).
- Folio `pageText` is a lossy literal-string extractor, documented.
- No `.pptx`/`.xlsx` interop; Quill DOCX is real (zip + OOXML).
- Nitro native build (Swift/Kotlin/C++ side of `Forge`) is unwritten —
  `nf-sys` is the C ABI it will call.
- No git remote → commits are local; no PRs.

## Studio workspace implementation — November 3, 2026

Implemented `packages/studio-workspace` over the existing layout core and wired
it into the Expo editor route and `apps/studio-preview`. The shared shell has
three dock zones, tabs, collapse/activate, move/reorder/resize controls, drag
previews, cancellation, compact bottom panels and host-owned presets. Zustand
stores contain UI/document projections; native document handles remain in refs.
The browser harness uses the actual Rust engines through a loopback CLI bridge.

| Check | Result | Evidence |
|---|---|---|
| Strict workspace typechecks, including Expo and browser harness | PASS | `pnpm -r typecheck` |
| Original host/product e2e tests | 32 PASS | `pnpm -r test` |
| Dock layout core tests | 12 PASS | same command |
| New workspace model tests | 8 PASS: isolation, atomic drag/cancel, invalid targets, geometry, compact reset/restore, presets and resize | same command |
| Browser bundle | PASS, Vite 7.3.7; 586.40 kB JS before gzip (size warning remains) | `pnpm --filter @nitro-forge/studio-preview build` |
| Seven-engine HTTP mutation, undo/redo, NFD1 snapshot/reopen; request-origin guards | PASS | `pnpm --filter @nitro-forge/studio-preview test:integration` |
| Frozen workspace lock | PASS | `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline` |
| Browser pointer docking | PASS: Document dragged left→right, status `outline docked` | connected Chrome UI |
| Browser keyboard movement | PASS: Enter on Pitch Commands→Move left; existing slide text retained | connected Chrome UI |
| Engine history survives layout changes | PASS: Quill paragraph undo/redo after moving Commands; layout save/reset/restore retains placement | connected Chrome UI |
| Preset reload | PASS: saved Tally bottom Commands restored after page reload and studio selection | connected Chrome UI |
| Measured responsive hosts / themes | PASS: full width, 768px, 390px; bottom Commands accessible; Prism retained two layers through theme/width changes | screenshots below |
| Browser snapshot download UI | NOT VERIFIED: browser download-wait tooling timed out; bridge snapshot/reopen verified above | no download claim |
| iOS/Android execution, native drag/stylus, VoiceOver/TalkBack, physical fold/hinge, XR | NOT RUN | no suitable running simulator/emulator; native runtime remains separate |

Screenshots: [desktop Tally](ux/evidence/studio-desktop-tally.png),
[390px host](ux/evidence/studio-compact-tally.png),
[768px light host](ux/evidence/studio-tablet-light-tally.png).
These are measured editor containers in Chrome, not native device screenshots.
Browser viewport emulation itself was not established.

Subagent implementation/review found and fixed stale async document actions
crossing studio sessions, panel responder remounts, compact presets reopening side
docks and incorrect PDF/snapshot status wording. The same document stays mounted
while changing layout, theme or measured host width. Switching studios intentionally
closes that studio's current temporary document.

The default stages are read-only projections of engine state. Native raster/PDF
painting, direct manipulation, media playback, object snapping, Rive integration,
independent native floating windows and the broader UX milestone acceptance packet
remain pending. No native manifest/window contract was modified or verified.
