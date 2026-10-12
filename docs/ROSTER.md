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
| Typecheck: ignition + 7 product packages | clean | `pnpm -r typecheck` |

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
| Independent review | Reviewer (subagent 3cb4c8fe) | FFI safety, engine spot-checks, TS protocol | ⏳ in progress |
| Example app | RN eng (main session) | Expo screens + useDocument hook | ⚠️ source + typecheck only |
| Design/UX | — | — | ❌ not staffed this session |
| AI workstream | — | — | ❌ not started (engines are provider-free as required) |
| Performance budgets | — | — | ❌ unmeasured; no perf claims made |

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
