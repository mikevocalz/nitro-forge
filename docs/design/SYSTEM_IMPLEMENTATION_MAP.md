# Suite design implementation map

2026-11-07. Source inspection only. This report maps the supplied suite brief to existing Forge code and the NYC-Tron ownership boundary. No application code, private design-pack assets, dependencies, native configuration or tests were changed for this report. No rendered, runtime, device or performance result is claimed.

Review standards used: public API and native ownership rigor associated with Rousavy's work; touch-first density and state clarity associated with Cuda's work. These are review criteria, not reviews or endorsements by those people. The private Forge design workflow and the local no-ai-slop writing skill informed the audit; their text and assets are not reproduced here.

## Existing owners

| Concern | Actual owner | Contract to retain |
| --- | --- | --- |
| Reusable controls | Released `@nyc-tron/ui` and platform adapter packages, bound by `packages/studio-workspace/src/nyc-tron-host.tsx` | Forge imports controls; it does not add a parallel `@forge/ui` implementation. |
| Host-specific primitives and native overlays | `packages/studio-workspace/src/ui.tsx`, `nyc-tron-host.tsx` and the consuming app's provider | Missing required provider/Popover/NativeDropdown throws. Actual native adapters stay host supplied. |
| Shared inner editor chrome | `packages/studio-workspace/src/index.tsx` (`ForgeWorkspace`) | One stable host-owned engine document; shared header, dock, panel and status behavior. |
| App-authored theme values | `packages/studio-workspace/src/theme.ts` | Preserve host overrides and separate engine data colors from chrome. |
| Theme compilation | `packages/studio-workspace/build-theme.mjs` | `theme.css` and `theme.native.css` are generated outputs. Change their source/generator together. |
| Instrument material explorations | `packages/studio-workspace/src/forge-directions.ts`, `apps/studio-preview/src/turret-lab.tsx` | Existing Workbench, Optics and Atelier remain the comparison set. Their existence is not a new screenshot or device pass. |
| Motion policy and feedback | `packages/studio-workspace/src/interaction-policy.ts`, `forge-directions.ts`, `turret-motion.tsx`, `turret-motion.native.tsx` | Native turret travel uses Reanimated; web uses CSS/Web Animations. Preserve reduced-motion state feedback. |
| Persona selection and composition | `persona.ts`, `persona-store.ts`, `persona-composer-model.ts` under `packages/studio-workspace/src/` | Design personas share one Prism document, engine undo and continuity. They do not become suite-wide app navigation. |
| Dock geometry and preset validation | `packages/studio-layout/src/index.ts`, `packages/studio-workspace/src/model.ts` | Normalized layout data and measured blocked regions remain distinct from engine documents and app window configuration. |
| Engine edits, history and persistence | `@nitro-forge/ignition` and each document API package | No design migration renames engine operation IDs or rewrites existing document envelopes. |
| Product entry descriptions | `packages/studio-workspace/src/app-manifest.ts` | Distinguish display branding from stable engine/package identities before any rebrand script. |

## Proven gaps against the brief

### Tokens and density

`theme.ts` exposes dark and light palettes plus one fixed `workspaceScale`. It does not expose a three-tier density resolver or a high-contrast palette. The generator emits dark/light CSS and native variants, not density or high-contrast variants. Its editorial font declaration is written directly in the generator rather than derived from the font object.

The current `prismThemes` changes base, raised, deep, line, text and muted colors as well as accent roles. This differs from the brief's shared-neutral, accent-only studio identity. Preserve the host's full theme override capability, but separate studio identity overrides from shared neutral/material tokens before migrating the default Prism palette.

`index.tsx` still contains typography and geometry values outside `workspaceScale`, plus literal white for a selected panel icon and literal shadow colors in the Prism header/status treatment. Those instances establish token drift in this inspected screen; this report does not claim every studio file was scanned for every value.

`forgeHitTarget()` already distinguishes compact/comfortable/presentation and input modality. That is a hit-target policy, not a complete density theme. Resolve the brief's compact/standard/comfortable naming against existing saved settings before changing public or persisted values. Do not silently turn presentation behavior into standard density.

The type scale is currently six named size roles, with repeated numeric values, rather than the requested seven-step optical UI scale. An explicit UI font family and platform text-scale mapping remain design decisions. Existing `useStudioTextScale()` behavior should be extended rather than replaced by fixed iPad measurements.

### Motion and platform materials

The inspected code has three motion definitions: interaction-policy presets, direction-specific detent travel, and shared feedback constants. Their press and popover/dock timings differ. This is a source-level consistency gap; no perceived timing or frame-rate measurement was made.

`turret-motion.native.tsx` uses shared values, animated styles and Reanimated timing/sequence calls. This is evidence for that native component's implementation approach only. It does not establish that every drag, reveal, sheet or panel transition runs on the UI thread.

`glassAllowed()` only checks the direction and contrast/transparency preferences. The web turret lab applies `backdropFilter` when it returns true. There is no platform-material capability in that helper, so the web exploration can render Optics blur even though the supplied brief excludes emulated glass on web. This finding concerns the web lab and shared policy; no native glass surface was observed.

The persona turret exposes host feedback callbacks, and interaction profiles describe haptic intent. A profile entry does not prove that each host emits the corresponding feedback or honors opt-out. Reuse NYC-Tron's haptic service when wiring actual host feedback.

### Chrome, ownership and distribution

`ForgeWorkspace` already has a shared document header, contextual row, panel rail, dock tabs, floating panels and status surface. It also has a Prism-specific branch. The context row renders caller-supplied `leadingActions` in a horizontal scroller without a typed seven-control limit or overflow rule. Define a command model and overflow selection before claiming the brief's context-bar contract is implemented.

The strict host UI provider is a useful existing boundary. Its `TokenScope` is optional: on native, absence preserves the host's theme rather than applying scoped variables. Any new per-studio token override must either be supplied by the native host or remain explicitly unavailable; it cannot rely on web CSS behavior.

`studio-layout` registers seven engine studios. `instrument-system.ts` separately includes `board` in its `ForgeStudio` union, while package discovery below found no Board studio package. Treat Board as catalog/planning scope until an actual package and host contract exist. Likewise, there is no discovered `studio-design` package: current Vector/Pixel/Layout/Sketch persona behavior is part of the Prism editor.

The seven document packages are headless document APIs. Their package names alone do not prove independently mountable editor packages. `@nitro-forge/studio-workspace` exports the shared workspace and Prism editor, and `apps/studio-preview` hosts the web preview. No `apps/forge` package or standalone `StudioShell` export was discovered.

No Storybook/story files were found by filename search under `packages/` and `apps/`. Existing web preview/lab entry points should be reused for initial real-task captures before introducing another runner. This search does not prove there are no other external story hosts.

`app-manifest.ts` centralizes task descriptions and glyph names, but workspace/studio source still contains product-facing labels. There is no discovered brand package or rebrand script in the inspected package inventory. A rebrand migration must preserve routes, IDs, file extensions and serialized documents where compatibility requires them; it cannot be a blind word replacement across protocol data.

### Capability truth

`persona.ts` explicitly marks paths, Boolean operations, pages and text frames unavailable in its current capability catalog. `instrument-system.ts` sets all catalog `releaseVerified` values to false. These catalogs must be reconciled with current engine operations before new screens claim those workflows. An implemented NYC-Tron UI control is not proof of a Forge engine operation.

The consumer pin in `tooling/nyc-tron.json` remains alpha.4. Newly implemented controls on NYC-Tron PR54 are not automatically present in that release. Preserve the current pin until library acceptance, packaging and a deliberate consumer upgrade occur.

## Minimal implementation order

1. Freeze the inspected ownership boundaries in the public delivery plan. Keep reusable controls in NYC-Tron, app tokens in Forge, engine operations in document APIs and platform resources in their existing owners.
2. Define a typed theme/density/material contract at the current `theme.ts` boundary, with backward-compatible defaults and explicit platform capabilities. Do not choose new palette/font values before the three real-task directions are reviewed.
3. Extend `build-theme.mjs` to derive web/native outputs from that contract. Add JSON output only if a current consumer needs it. Audit dark/light/high-contrast and density mappings without changing established app dimensions or orientation.
4. Migrate the shared workspace's literal typography, shadows, selected-icon ink and repeated sizes to semantic roles. Verify the same real editing task and state at each density; preserve sufficiently large input targets.
5. Consolidate motion policy, direction feedback and platform material admission. Keep the native and browser adapters separate, preserve reduced motion and use the existing haptic opt-out owner. Bind design ratios to installed animation APIs rather than passing undocumented arguments.
6. Add a typed contextual-command/overflow contract through existing NYC-Tron menus. Keep editing-tool placement distinct from app navigation and foldable/headset physical-right navigation policy.
7. Reuse the persona store and workspace preset ports for design-editor continuity. Test the actual engine path before promoting catalog capabilities from unavailable or unverified.
8. Introduce standalone editor mounting boundaries only after one studio is proven through the existing host. Reuse the document API packages, keep peers/version constraints explicit, and avoid importing another studio's UI or engine.
9. Centralize mutable display branding separately from stable protocol identity, then exercise rebranding in an isolated checkout. Preserve the working repository and existing documents.
10. After the user's implementation review, run the agreed type/source/browser/native checks and physical accessibility/performance matrix. Record actual outcomes; no timing or award-level quality is inferred from the source audit.

## Discovered packages and apps

Inventory was read from each immediate `packages/*/package.json` and `apps/*/package.json`. It includes 17 packages and five apps. An empty manifest description is recorded as absent rather than invented.

| Directory | Package name | Manifest description |
| --- | --- | --- |
| `packages/agpl-speed-curve` | `@nitro-forge/agpl-speed-curve` | Experimental AGPL speed-curve adapter, derived from CapCraft, for Expo SDK 58. |
| `packages/audio-ui` | `@nitro-forge/audio-ui` | Audio API native PCM recording and shared graph playback, with browser MediaRecorder capture. |
| `packages/cadence` | `@nitro-forge/cadence` | Nitro-Forge cadence document API. |
| `packages/collaboration-server` | `@nitro-forge/collaboration-server` | Authorized durable revision collaboration service for Forge documents. |
| `packages/folio` | `@nitro-forge/folio` | Nitro-Forge folio document API. |
| `packages/icons` | `@nitro-forge/icons` | Original Rive-ready outline/filled icon system for all Nitro-Forge editor engines |
| `packages/ignition` | `@nitro-forge/ignition` | Nitro-Forge native integration layer: engine session contracts, Nitro HybridObject spec, and host transports. |
| `packages/media-ui` | `@nitro-forge/media-ui` | Forge media controls: re-exports NYC-Tron UI's seek bar, waveform lane, level fader and timebase math |
| `packages/native-signal` | `@nitro-forge/native-signal` | Expo SDK 58 / Expo Modules 2.0 native waveform analysis adapter for Nitro Forge. |
| `packages/pitch` | `@nitro-forge/pitch` | Nitro-Forge pitch document API. |
| `packages/prism` | `@nitro-forge/prism` | Nitro-Forge prism document API. |
| `packages/quill` | `@nitro-forge/quill` | Nitro-Forge quill document API. |
| `packages/splice` | `@nitro-forge/splice` | Nitro-Forge splice document API. |
| `packages/studio-layout` | `@nitro-forge/studio-layout` | No description in manifest |
| `packages/studio-workspace` | `@nitro-forge/studio-workspace` | No description in manifest |
| `packages/tally` | `@nitro-forge/tally` | Nitro-Forge tally document API. |
| `packages/telemetry` | `@nitro-forge/telemetry` | Nitro-Forge test and telemetry adapter: consent-gated engine timings, failures and debug traces, plus a capturing adapter for tests. |
| `apps/console` | `@nitro-forge/console` | Executable workflow demo: drives every Nitro-Forge engine end-to-end via nf-cli. |
| `apps/example` | `@nitro-forge/example` | No description in manifest |
| `apps/forge-audio-lab` | `@nitro-forge/audio-lab` | No description in manifest |
| `apps/forge-media-lab` | `@nitro-forge/media-lab` | No description in manifest |
| `apps/studio-preview` | `@nitro-forge/studio-preview` | No description in manifest |

## Studio-to-instrument map

These are ownership/task mappings based on the discovered document API packages, app manifest and current instrument catalog. They are not a claim that every catalog instrument is implemented or accepted.

| Document package | Current task | Instrument families to audit |
| --- | --- | --- |
| `@nitro-forge/prism` | Image, shape and design-persona editing | Chromatic, ink, layers, spatial precision, overlays |
| `@nitro-forge/cadence` | Tracks, notes and arrangements | Harmonic, temporal, automation, overlays |
| `@nitro-forge/splice` | Video sources, clips and timing | Temporal, color, synchronized audio, overlays |
| `@nitro-forge/quill` | Documents and writing | Text, document structure, layout, overlays |
| `@nitro-forge/tally` | Figures, formulas and sheets | Formula/data, numeric precision, ranges, overlays |
| `@nitro-forge/pitch` | Slides and visual presentation | Layout, objects, animation timing, overlays |
| `@nitro-forge/folio` | PDF pages and annotations | Page geometry, markup, document structure, overlays |

## Evidence limits

Only files, manifests and source search results were inspected for this report. Existing tests were not run. No current screenshot, native compile, interaction replay, screen-reader pass, physical Pencil/foldable check, isolation install, rebrand run or performance measurement is asserted. The separate research report owns its image observations and evidence limits.
