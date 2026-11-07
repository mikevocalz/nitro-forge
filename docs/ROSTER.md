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
| splice-engine tests (incl. track flags, ripple/roll/slip/slide, insert/overwrite, transitions, markers, loop range, batch) | 44 pass | `cargo test -p splice-engine` |
| splice e2e via nf-cli (timeline ops) | 11 pass (4 existing + 7 new) | `pnpm --filter @nitro-forge/splice exec vitest run` |
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
| Splice engine | Video systems eng (subagent 75836ea5) | timeline, split/trim/speed; 2026-11-05: track flags, ripple/roll/slip/slide, insert/overwrite, transitions, markers, loop range, batch | ✅ 44 tests |
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


## Independent app entry and writing flow — November 3, 2026

User clarified that each app is independently requested from a list. Replaced
browser studio tabs with an app launcher and per-app hash routes; apps open on
first request and retain separate sessions while navigating the list. Browser
reload still ends temporary sessions. The native Expo list already uses separate
routes. Shared shell code remains reusable without imposing a suite-mode UI.

Quill now provides a Zustand-backed essay draft, Unicode-aware minimal engine
edits, conflict detection, snapshot flush and DOCX/NFD opening / DOCX export in
the browser harness. Native example snapshots also flush its writing surface;
native file selection remains a host integration. Formatting outside edited spans
is preserved by the engine; this writing surface is a plain text editor, with
existing format commands remaining available.

Follow-up evidence:
- Workspace tests: 11 PASS (8 docking + 3 text-diff); workspace/example/browser
  typechecks PASS; browser bundle PASS (594.78 kB JS, existing size warning).
- `pnpm --filter @nitro-forge/studio-preview test:integration` PASS: seven engines,
  six Unicode/newline essay edit scenarios, real DOCX export/import and independent
  document state. Integration server stops itself afterward.
- Browser PASS: app list → Quill, type/apply two paragraphs → app list → Tally →
  app list → Quill, essay retained. [App list](ux/evidence/app-list.png) and
  [writing space](ux/evidence/quill-writing-space.png) captured.
- Native essay execution NOT RUN. Automated browser file-selection check blocked
  by Chrome extension file-access permission; permission unchanged. DOCX engine
  import/export passed via the integration bridge, not the file-picker UI.


## Reference-driven visual pass — November 3, 2026

Reviewed the complete current docs plus relevant remote-branch visual/native/icon
contracts. All seven exact Mobbin images from the original ledger were opened
and inspected, alongside additional Craft writing references and the official
Affinity layout image. See [DESIGN_REFERENCE_AUDIT.md](ux/DESIGN_REFERENCE_AUDIT.md)
for exact sources and what was actually visible. No Mobbin artwork is vendored.

- Reworked the existing shared workspace: single document header, one context
  toolbar, optional inspector, original icon rail, Workspace menu, compact panel
  controls and writing-first defaults. History starts collapsed.
- Reused the exact authored icon source from the icons branch, adding typed native
  exports. Expo 54's supported SVG version is pinned. Selected/disabled states and
  reduced-motion handling are active; compiled Rive remains pending.
- Central semantic theme tokens feed native RN styles and generated Tailwind v4
  CSS. Host overrides remain supported. Native home uses the same app manifests,
  theme and glyphs, with typecheck evidence only. Duplicate native headers removed.
- App launcher has original decorative tool previews and actual opened-session
  state. No fabricated recent files, usage counts or document thumbnails.

| Check | Result | Evidence |
|---|---|---|
| All package/app typechecks | PASS | `pnpm -r typecheck`; example rechecked after native home change |
| All JS/TS tests | 61 PASS: 32 host/product, 12 dock core, 12 workspace/text, 5 icon | `pnpm -r test` |
| Browser bundle and Tailwind v4 token compilation | PASS; existing large-chunk warning remains | `pnpm --filter @nitro-forge/studio-preview build` |
| Seven-engine, Unicode essay, DOCX import/export and independent documents | PASS | `pnpm --filter @nitro-forge/studio-preview test:integration` |
| Frozen lockfile | PASS | `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline` |
| Browser controls | PASS: menu/reset, keyboard undo/redo, drag left→right, compact bottom Commands, essay retained through theme/width | Chrome UI |
| Breakpoint band / animated icon cleanup | PASS after fixes: stable outer 724px measurement, real SVG web resolver, RN Animated global alias in both dev and production | Chrome and generated dev code |
| Native iOS/Android, assistive technology, physical fold/pen/XR | NOT RUN | no native execution claim |

[Before/after board](ux/evidence/quill-before-after.html),
[comparison PNG](ux/evidence/quill-before-after.png),
[new app list](ux/evidence/app-list-redesign.png),
[writing page](ux/evidence/quill-redesign.png),
[390px light container](ux/evidence/quill-redesign-compact-light.png).
Screenshots depict measured browser containers, not native devices.

Review found and fixed a rail-induced breakpoint oscillation and an RN Web
Animated cleanup error. A minimum-stage fixture was adjusted from 400px to 380px
because the narrower default left dock now legitimately fits at 400px; the
stage-space rejection invariant remains tested. Shared native-control extraction
with Moyo, SDK-specific Expo UI adapters, native visual baselines and Rive
compilation remain separate release gates. App window/manifest contracts unchanged.

### Studio PhotoCraft / Affinity refresh — November 3, 2026

Shared editor uses cool neutral themes, violet selection, 8pt controls and 12pt
panels, grouped rail controls and denser inspector hierarchy. Browser and native
source app lists use compact directories; separate routes and sessions remain.
Quill paper branding was removed, paragraph labels made readable, and browser
file-action labels shortened while keeping full accessible names.

Prism now uses its actual `flatten` RGBA output, encoded as bounded PNG for
native/web Image. It supports existing engine operations through contextual
rectangle/ellipse/raster creation, raster fill, layer selection, visibility,
opacity, reordering and removal. Default generic Prism docks are collapsed to
reserve the canvas; its context Layers panel opens on first wide measurement.
PNG transfer is limited to 1,048,576 pixels and 4096px per side with explicit
fallback. This is not freehand/node editing, photo import, PSD support or
Affinity feature parity. Native source is wired but native runtime is unverified.

Executed: `pnpm -r typecheck`, `pnpm -r test` (65 tests), preview production
build, frozen lockfile installation, and isolated integration bridge. New proof
checks exact RGBA for raster/rectangle/ellipse compositing, layer visibility,
opacity, order, removal/undo, PNG and snapshot restore. Encoder tests independently
check CRC/zlib/alpha and block boundaries. A regression test covers canvas-first
collapsed Prism preset restoration. Final browser build has the existing >500KB
chunk warning (679KB minified JS), not a build failure.

Chrome native accessibility fallback: Quill typing/apply and desktop/390px host,
Prism fill/shapes/50% opacity/visibility/undo, layer panel dismissal at390px,
and Prism artwork retained through app-list/Quill navigation. Browser extension
connection was unavailable for these captures; native Chrome screenshots include
browser chrome. Full OS/browser matrix, screen reader, physical phone/stylus and
native runtime were not run. Screens in docs/ux/evidence/*refresh.jpg.

Reference evidence and continued critic scores are in docs/ux/studio-refresh.
REA6.8.0 source-only static analysis ran successfully using temporary Node26.12.1,
without global configuration changes; partial coverage and 68 observations are
not runtime validation or bug counts. The bounded summary is committed; full
report stays in ignored artifacts/rea.

### Canonical NYC UI integration — November 3, 2026

User selected `nyc-mon/packages/ui`. Studio now requires a host-injected
`StudioUIProvider`, with actual canonical semantic primitives, native Menu and
Select bindings, Image and input adapters. Browser landmarks and FilePicker
use `@acme/ui/html`. An AST check rejects direct React Native visual imports
inside shared Studio. Dock bars and layer bars reuse the same drag controller.
A release-before-measurement race was reproduced and fixed with an awaited,
cancellable measurement transaction.

Executed: all package typechecks, 70 package tests, preview production build,
and seven-engine integration checks passed. Canonical NYC UI additionally
passed its typecheck, scoped lint and three adapter regression tests. Browser
manual evidence confirms provider Menu/Select operation and real layer drag,
reorder and undo. The final app-list review exposed canonical default style
conflicts; host styles were corrected afterward. A fresh screenshot and the
new browser FilePicker interaction remain unverified because the Chrome
automation window became unavailable. DOCX engine import/export integration
passed independently. No native runtime/device or full browser matrix run.

Canonical UI commit `4154ea344987de4bee94d4ee0e9f0249f66e8087` is local only.
CI pins that paired source commit and was not run remotely; publish the NYC
commit before the NitroForge branch. The legacy Expo54 example is not asserted
compatible with the Expo58 UI runtime. SDK/window/orientation/manifest contracts
remain unchanged. See `docs/ux/studio-refresh/OWN_UI_INTEGRATION.md`.

### Craft Anything browser inspection — November 3, 2026

Official Craft Anything v0.3.0 CLI archive verified against its release digest,
then used through its own persistent MCP server in Clean room mode. Captured
launcher, Prism and the public Affinity iPad page at390/768/1440. Captures found
and drove fixes for canonical utility precedence and tag-dependent helper/footer
styles. All three final launcher images were inspected by the main agent and
continued critic, with readable text and mobile helper hiding confirmed. All
three Prism baseline images were inspected. Preview typecheck and production
build passed after fixes. Quill open timed out; native runtime, file-picker
interaction and the full OS/browser matrix remain unverified. Raw evidence
stays ignored; final launcher images and provenance are committed in docs/ux.
No nested rebuild, global registration or native configuration changes.
See `docs/ux/studio-refresh/CRAFT_ANYTHING.md`.

### Affinity canvas composition — November 3, 2026

Prism now uses a local graphite/blue palette and continuous measured canvas
with floating tool capsule, compact selected-layer ribbon, detached Layers and
stationary fill strip. The artboard fits both available dimensions and preserves
its aspect ratio. Generic dock controls remain reachable through Workspace.
No app-window/orientation/manifest changes or unsupported editor tools. Native
resources remain refs; view state remains per-instance Zustand.

Craft Anything live browser walks created real violet rectangles and teal
ellipses at390/768/1440. Round1 visual review led to compact ribbon and neutral
opacity Menu refinements. Round2 found a genuine clipped popup; a dispatched
click was not accepted as proof of an engine edit. Details, subsequent proof and
limits are in `docs/ux/studio-refresh/AFFINITY_FEEL.md`. Workspace21 tests, all
package typechecks, preview build and seven-engine integration passed. Native
runtime and full browser/OS/device matrix remain unverified.

Final Round3 browser proof: the complete opacity menu is visible, and actual
selection changes the engine layer to50% with a visibly blended canvas at
390/768/1440. Phone final closes Layers without changing the artwork. Main and
continued critic inspected final captures. Final21 workspace tests/typecheck
and preview build passed after popup fix. Images: docs/ux/evidence/prism-affinity-*.png.

### Responsive verification — November 3, 2026

Craft Anything reproduced and verified fixes for narrow-header Save clipping,
a 26px landscape artboard and viewport/stacking clipping of opacity options.
Measured viewport geometry, adaptive header packing and the source-owned NYC
web Menu now support 320×480,320×568,390×667,844×390,1024×768 and 1440×900.
All six accepted runs show actual shape edits and 100%→50% opacity changes;
short landscape uses focus-scroll plus visible click to reach clipped options.
A previously interrupted tablet run passed a frozen-source retry. Keyboard-only
activation, native hardware and the full browser/OS matrix remain unverified.
Success notices expire without altering document state; focused short phone
and landscape images confirm unobscured paper afterward.

All package typechecks, 25 workspace tests, the visual import boundary and
preview production build passed. NYC UI full typecheck, 3 new Menu placement
tests and scoped lint passed. Its local-only paired commit is
c8ac0ddab89076eb4bc28036c5befd7d7d4ab70c; CI pins it but remote CI was not run.
Publish paired NYC source before NitroForge. No native window/config changes.
See docs/ux/studio-refresh/RESPONSIVE.md and prism-responsive-*.png evidence.

### Canonical component inventory and reuse — November 3, 2026

Audited 42 public NYC UI export entries, root/group barrels, platform contracts
and 41 NeonBlade catalog entries. Bound and consumed actual Button/IconButton,
TabBar, SegmentedControl, Toolbar, FieldGroup/KeyValueList, static List/ListItem,
Card, Badge, Banner/ErrorMessage, EmptyState and NightScope, alongside existing
Menu/Select/Input/Image/semantic components. Open uses the actual DropZone and
keeps its FilePicker path. Layer sorting retains its measured domain controller.
The component-first requirement is persisted in AGENTS.md.

Eleven fresh Craft Anything scenarios passed after fixes for tab-order jumps,
compact captions/colour, Card badge wrapping, DOM accessibility labels and RN
line-height conversion. Named Quill text entry/apply updates the real engine
and renders top-left/wrapped at desktop/phone. The motion ESM runtime failure
is fixed through actual installed-module resolution and a UI module export
guard, rather than a replacement motion/control implementation.

Executed 28 workspace tests, all package typechecks, source UI typecheck/lint,
six focused style/type-scale tests, UI module contracts, preview build and
seven-engine integration. Native runtime/hardware, full OS/browser matrix,
screen readers and real drop/picker interaction remain unverified. Paired NYC
commit 782c682ea684606111e612242a66761d50137f95 is local, pinned in CI; remote
CI not run. Native window/config contracts unchanged. See
docs/ux/studio-refresh/UI_COMPONENT_AUDIT.md and docs/ux/evidence/kit-*.png.

## Studio Affinity control finish — November 3, 2026

Canonical NYC UI commit `75617163382235ed698e2230e9eefb70c8e19e06` adds opt-in
Studio appearances to the existing shared controls. Prism adds a direct wide
panel rail, quieter layer selection and a larger measured artboard. Native
window/configuration and document engine contracts are unchanged.

Verified locally: all package typechecks;28 workspace tests; the UI boundary
check;4 motion/18 control export module checks; browser production build;
canonical UI typecheck, scoped13-file lint and6 type-scale/style tests.
The existing production chunk-size warning remains. No remote CI run is claimed.

Craft Anything round1 passed6 fresh scenarios. Final round2 passed5 fresh
scenarios covering1440 desktop,768 tablet,390 phone, Properties open/close and
light theme. Screenshots show real rectangle/ellipse edits,50% opacity and
restored canvas geometry after panel closure. One standalone desktop browser
WebSocket failure is retained and excluded; the successful extended desktop
scenario repeats the same editing flow. A startup timeout occurred before app
navigation and succeeded on retry. Both visual review rounds were inspected.

Final proof index: `artifacts/craft-anything/affinity-evolution-r2/verified-summary.json`.
Committed representative screenshots: `docs/ux/evidence/affinity-studio-*.png`.
Portable desktop/phone scripts: `apps/studio-preview/qa/affinity-editor-*.json`.
Native runtime, physical input, screen readers and full OS/browser matrix are
unverified. Rea source analysis is recorded separately in
`docs/ux/studio-refresh/rea-workspace-summary.json` and is not runtime proof.

## Stable tablet canvas — November 3, 2026

Prism Layers now starts closed below1100px of measured editor width and overlays
rather than resizing the artboard on those layouts. Explicit panel choices
survive subsequent measurement. Desktop reserved-panel layout remains available.
Native app window dimensions, orientation, manifests and engine contracts did
not change.

Verified locally:29 workspace tests (including closed/open artboard geometry),
all package typechecks, UI import boundary and production build. Four actual
Craft Anything cases at768/1024/390/1440 show real shape creation,50% opacity,
Layers open/close, unchanged overlay artboard geometry and desktop restoration.
Full-size screenshots and captured DOM geometry were inspected independently.
The response-size limit required supported evidence pagination; all recorded
steps were successful. Proof is indexed in RESPONSIVE.md. Native runtime,
physical input and full browser/OS matrix remain unverified.

## Prism existing-shape fill editing — 2026-11-04

Studio's existing Fill layer action now works for selected rectangles and ellipses,
not only raster layers. `setShapeFill` and the typed `PrismDocument.setShapeFill`
API change only RGBA fill in the original Rust document, preserving layer ID,
geometry, name, opacity, visibility and stack order. The operation records one
Rust history entry; it adds no parallel document/history store or upstream code.
The existing horizontally scrolling adaptive palette reserves space for this
action for both shape and raster selections. Selecting a swatch alone still only
chooses the color; Fill layer commits it.

Local checks: 40 dock/workspace tests, Prism/Studio/example/preview TypeScript,
canonical UI boundary/module checks and preview production bundle passed.
Rust toolchain is unavailable locally; new Rust tests and typed nf-cli tests
are committed and included in the existing Studio CI workflow, not claimed as
executed locally. The Rust cases cover rectangles/ellipses, rendered pixels,
transparent fill, invalid channels/targets, atomic failure preserving redo,
one-step undo/redo and snapshot restoration. No native/device or interactive
browser validation of this new action has been performed.

## Prism bounded shape geometry editing — 2026-11-04

The original Prism engine now exposes `transformShape`: relative translation and
positive axis-aligned scaling anchored at the top-left, committed as one Rust
history entry. It retains shape kind, fill, layer identity and all layer metadata.
Computed non-finite or non-positive bounds, raster targets and malformed inputs
are rejected before document/history mutation. Off-canvas shapes remain valid
and are clipped by the existing renderer.

Studio uses the canonical Menu in its existing context bar for selected shapes:
1px/10px directional moves and 10% enlarge/shrink. The menu resets on selection change or host busy state, while old callbacks
reject stale state. Its trigger stays mounted across its own edits to preserve
keyboard focus.
No parallel geometry state, new package, copied upstream source, or renderer
migration was introduced. Arbitrary numeric bounds, pointer resize handles,
rotation, skew, path editing and full ArtCraft parity remain outside this slice.

Local verification: 42 dock/workspace Node tests and affected TypeScript checks
passed. Rust and typed-host tests plus the browser bridge scenario are in the
existing CI workflow; local Rust execution remains unavailable. Browser module
and build checks are separate from interactive browser or native/device QA,
which has not been performed for the new transform menu.

## Prism direct artboard selection and shape movement — 2026-11-04

Added touch/pointer responder wiring to the existing Prism artboard. Taps select
by topmost rectangle/ellipse pixel coverage and raster alpha; hidden/transparent
layers are skipped. Dragging a shape shows a dashed bounds preview, then issues
one existing `transformShape` command on release. The composite remains the Rust
engine result. Layer controls and the Transform menu remain the accessible
alternatives; this does not add pointer resize/rotation handles.

The gesture model handles delayed or failed measurements, selection changes,
document/viewport changes, multi-touch cancellation, Escape, responder termination,
unmount and repeated releases. Release remeasures the artboard and cancels if
its origin or dimensions moved, including ancestor scrolling. Web coordinates
account for page scrolling; captured scroll/resize/blur also cancel. A tap or
cancel records no history. Raster selections cannot dispatch shape transforms.

Local checks: 53 dock/workspace tests and Studio/example/preview typechecks pass.
The production bundle and canonical UI boundary/module checks pass. The existing
real-engine bridge test now drives the same gesture planner into Rust, checking
pixels, one-step undo/redo and save/restore in CI.

Interactive Chromium validation was attempted against an isolated component
fixture but blocked before browser launch by `socket() failed: Operation not
permitted`, including after tool escalation. No pointer/touch interaction success
or native device evidence is claimed. The gesture wiring is statically reviewed
and unit tested; physical input, browser interaction and assistive-technology QA
remain release gates.

## SDK58/latest host migration candidate — 2026-11-04

The canonical shared Image, root Gesture Handler adapter, latest npm host pins,
Nitro v1 session integration and Skia web asset work are preserved in this draft.
The provisional SDK54 additions were replaced before publication.

**Blocked:** Metro0.87.2 and latest Expo CLI's file-map fork have incompatible
runtime-root APIs. (The release-age rejection noted earlier no longer applies:
the workspace sets `minimumReleaseAge: 0` as of 2026-11-04.)
Do not treat this as native-ready, a clean-install pass, or complete parity.
See docs/native/SDK58_METRO_UPGRADE.md for exact versions, reproduction,
source checks, native autolinking evidence and remaining release gates.

## Recovered alpha.3 Studio integration (2026-11-05)

- NYC-Tron release pins and SHA256SUMS verified against all four consumed tarballs.
- Studio suite: 148 tests passed; Studio and preview TypeScript passed; example TypeScript passed.
- Preview production build passed; UI boundary check passed.
- NativePopover and grouped Select are bound in both hosts; Layers uses its original 280pt width.
- No device, screen-reader, foldable, or native rebuild acceptance was performed for this change.

## Audio API migration draft — November 4, 2026

Audio lab and audio-ui migrate native capture and shared playback to
react-native-audio-api 1.0.0; browser capture directly uses MediaRecorder
because upstream has no browser recorder. Seven dependency-free audio graph /
PCM contracts pass locally. Full install correctly blocked by the 24-hour
package-age policy until 18:01:08.810 UTC; lockfile, TypeScript, Metro, native
builds and hardware capture/playback are pending. No Cadence project attachment,
multitrack DAW, Meta runtime or production readiness is asserted.
See packages/audio-ui/README.md for API/skill roster and exact boundaries.

## Recovered alpha.3 audio integration (2026-11-05)

- All six NYC-Tron dependency references use v0.1.0-alpha.3; the UI and platform-services tarballs were downloaded and checked against release SHA256SUMS.
- Audio UI: 68 tests pass, including native policy-action ordering and capture/preview ownership. The eight dependency-free graph tests pass.
- Audio UI and audio-lab TypeScript pass; the audio-lab web export passes.
- Expo autolinking resolves NYCTronPlatformServices alpha.3 on Apple and Android. Android uses the package's Expo Modules v2 path; an empty legacy modules array is expected.
- Preview intent now lives in NYC-Tron's session store. Audition stops on interruptions, output loss and resets and requires a new Play press. Recorders keep their own capture lifecycle.
- No native rebuild, microphone/device, routing or interruption acceptance was run for this follow-up.


## Tally atomic range edits — November 5, 2026

- Added `setRange`, `fillRange`, grouped inverse journal entries, reference-token
  shifting, TypeScript methods and the `commitTallyFill` UI callback adapter.
- Local Rust workspace tests: 191 passed, including Tally's 34 tests.
- Local Tally Vitest: 24 passed, including two new live `nf-cli` range-operation
  tests and a callback routing test. Workspace TypeScript: 9/9 packages passed.
- Frozen pnpm 10.32.1 install and fresh `cargo build -p nf-cli`: passed.
- Review fix: references and range writes are bounded to the sheet
  (XFD1048576), not the u32 address domain; a range with an off-sheet endpoint
  shifts to a single `#REF!` instead of the unparseable `#REF!:A2`. After the
  fix: Rust workspace 192 passed (Tally 35), Tally Vitest 25 passed (three live
  `nf-cli` range-operation tests), workspace TypeScript 9/9.
- Same bound for every address-taking op: `setCell`, `clearCell`, `getCell`
  and `getRange` past XFD1048576 return `out_of_bounds` with no mutation or
  journal entry; formula references past the sheet evaluate to `#REF!`;
  `restore` rejects off-sheet cell keys. Rust workspace 193 passed (Tally 36),
  Tally Vitest 26 passed (four live `nf-cli` range-operation tests).
- Rust/CLI evidence only. Native JSI hosts, clipboard OS APIs, hardware and
  the unreleased NYC-Tron fill prop's installed consumer contract: NOT RUN.
- Adds no UI copy or dependency upgrade; stack remains based on Tally grid
  cluster PR #50, with the released NYC-Tron alpha.1 pin unchanged.

## Recovered alpha.3 Tally consumer (2026-11-05)

31 tests pass, including atomic paste/fill against a freshly built nf-cli. Tally TypeScript and the release URL/lockfile/SHA256 pin check pass. Includes the local #50/#54 stack.

## Recovered alpha.3 Office consumer (2026-11-05)

Pitch 17, Quill 12 and Folio 10 tests pass against a freshly built nf-cli. All three package typechecks and the release URL/lockfile/SHA256 pin check pass. Includes the local #53/#55 stack.

## 2026-11-04 advanced component bridge work

- Cadence typed gain/pan knob adapter **SOURCE IMPLEMENTED** (`@nitro-forge/cadence/instrument-adapter`). Verified on Ubuntu CI: TypeScript, Vitest + real Rust host passed [run 41902604860](https://github.com/mikevocalz/nitro-forge/actions/runs/41902604860). Native iOS/Android and desktop still NOT RUN.
- Graph routing, real crop, MIDI piano roll, Media3/AVFoundation decoder, Ink/Muse and spatial renderer **NOT IMPLEMENTED**. The roster in `ADVANCED_NATIVE_PORT_ROSTER.md` is a plan, not device proof.

## Recovered alpha.3 Mixer consumer (2026-11-05)

22 Cadence tests pass against a freshly built nf-cli. Cadence and native-cadence example typechecks pass. Root and example lockfiles and all release hashes pass the pin verifier.

## Recovered alpha.3 Timeline consumer (2026-11-05)

23 Splice tests pass against a freshly built nf-cli; Splice TypeScript passes. The consumer contract pins the alpha.3 release tarball. The unreleased second NYC-Tron timeline cluster is still deferred.

These are local source/protocol checks. No new native build or device acceptance was run. The follow-up has not been pushed or merged.

## Phase 1 combined recovery — 2026-11-05

The six alpha.3 follow-ups are combined locally on `codex/phase1-alpha3-integration`.
The combined workspace passes 245 Rust tests and 394 package tests (one existing native check skipped), all package typechecks, eight audio graph tests and two lab Metro regression checks. Studio, audio-lab and media-lab browser builds pass. Release-pin/hash and UI-boundary checks pass.

Integration fixed lab Metro watch folders so pnpm assets can be exported and preserved existing Expo/Uniwind configuration. Root `test:rust` now targets the actual Cargo workspace. Studio app configuration remains byte-identical to its baseline. No new native/device validation, remote push or PR merge is claimed.

See `docs/recovery/PHASES.md` for phases 2–6 and `docs/recovery/roster-status.tsv` for all 341 rows and 21 status columns.

## Phase 2 timeline source completion — 2026-11-05

NYC-Tron's local second timeline cluster is integrated and tested: 544 source/model/render tests, 254 full-lane Chromium checks, workspace build/types and package export/pack checks pass. Track/marker text commits are deduplicated across Enter and blur while the engine response is pending.

Forge's bound timeline callbacks pass 25 Splice tests against real Rust and TypeScript. The explicit `verify:timeline-source` command checks the actual built, unreleased component declarations while production pins stay on alpha.3. No new Rust code was added. No new release/native/device acceptance is claimed. See `docs/recovery/PHASE2.md` and the updated 341-row status table.

## Phase 3 canvas source completion — 2026-11-05

Recovered canvas/layers/selection/vector controls and the Prism engine operations are integrated locally. NYC-Tron passes 617 source tests and 323 Chromium tests, builds/types/exports and local packing. Forge passes 286 Rust tests, 408 package tests (one existing native skip), workspace types and the actual built-source canvas contract. Prism includes five new real-engine adapter scenarios. Production pins stay alpha.3; native/device acceptance and publication remain pending. See `docs/recovery/PHASE3.md` and the updated 341-row table.

## Phase 4 audio source completion — 2026-11-05

Recovered audio routing/inserts/automation/analysis and MIDI batch/channel controls are integrated locally with Cadence engine ops and a serialized mixer adapter. NYC-Tron passes 692 source tests and 414 Chromium tests, workspace build/types and export/pack checks. Forge passes 317 Rust tests and 421 package tests (one existing native skip), all workspace types and the actual built-source contract. Cadence passes 35 tests including five new real-engine adapter cases. Offline engine evidence does not establish realtime device audio, native builds or physical-device acceptance. Pins stay alpha.3. See `docs/recovery/PHASE4.md` and the updated 341-row table.

## Phase 5 workspace/color/transfer completion — 2026-11-05

Workspace/presets, contextual overflow, file transfer, color dialog and presenter session ink controls are integrated locally. NYC-Tron passes 713 source tests, 427 Chromium tests, builds/types, 351 export checks and 13 local packs. Forge passes 327 Rust tests and 446 package tests (one existing native skip), workspace types and the actual built-source consumer contract. WorkspaceSession keeps one document, formats produce real bytes and explicit delivery errors, Prism palette/new/fill history is tested, and WAV effect output is continuous. Presenter persistence/remote transport and native/device acceptance remain pending. See `docs/recovery/PHASE5.md` and the 341-row table.

## Recovery phase 6

See [PHASE6](recovery/PHASE6.md): 340 Rust / 446 Forge package tests pass, one pre-existing native check skipped. Actual linked C++ task/binary/cache and FIFO tests and generated-header compilation pass. NYC-Tron has 716 source tests, 435 full Chromium tests and an actual iOS simulator app build. Native runtime, Android decoder, complete RNW app and QNX gates remain explicitly open.

## Focused P02 recovery follow-up, 2026-11-07

`pnpm --filter @nitro-forge/ignition exec vitest run tests/recovery-ownership.test.ts tests/autosave.test.ts tests/collaboration-checkpoint.test.ts` passed 20 tests in 3 files. Seven new fault-injected cases cover Buffer ownership, recovery cancellation boundaries, aggregate cleanup errors and close-during-notification scheduling. This is focused JS/CLI evidence; native/device cancellation and platform storage acceptance remain NOT RUN.

## P10 photo catalog source checkpoint (2026-11-07)

Registered `photo` catalog metadata/version engine and typed API. Focused crate, CLI/tag/ordinal and v1 FFI checks plus source typechecks are recorded in [the source report](completion/reports/P10-registered-photo-catalog-source.md). This is not a RAW provider, develop renderer, native consumer acceptance or full P10 completion. Existing seven engine tags/ordinals are preserved and photo appends7.


## P11 immutable Motion raster source checkpoint (2026-11-07)

Motion now persists owned immutable straight-sRGB RGBA8 assets and real raster layers using the existing Prism binary upload/compositor. Focused evidence: full Motion engine suite 14 passed; registered binary FFI ownership/pixel/invalid-input case 1 passed; actual CLI caller-subview copy/shared-layer/opacity/reopen and empty/legacy describe cases 2 passed; direct source typecheck passed. Exact commands, logical storage budgets, old-shape compatibility and remaining gates are in the [raster source report](completion/reports/P11-motion-raster-source.md). No native target run, decoder/encoder, default product activation or full P11 completion is implied.

## P10 decoded develop preview source checkpoint (2026-11-07)

Photo persists version recipes and processes real bounded straight-alpha sRGB RGBA8. Eleven Photo engine tests and eight TypeScript tests pass, including identity/color/alpha, persistence, stale authority, owned input and malformed/oversized responses. The parent independently verifies a binary FFI preview and a real Photo-to-Motion CLI pixel/history/reopen flow. Those use synthetic decoded pixels, not a RAW decoder or original-file provenance proof. See [the develop source report](completion/reports/P10-nondestructive-develop-preview-source.md). No native target, full RAW controls or P10 acceptance is inferred.
