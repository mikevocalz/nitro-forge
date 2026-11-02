# UI-01..UI-10: extract the same shared native Expo UI into independent NitroForge packages

**Type:** implementation design / source extraction roster. No code moved in this PR. **Root requirement:** NitroForge's optional editor UI and Moyo's `@acme/ui` must consume the *same source implementations* with an independent package release; neither has a cloned near-copy of the others' panels/controls.

## Verified Moyo baseline (2026-11-02)
Current actual source includes:
- [`packages/ui/index.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/index.ts) as the semantic component index. Reuse/compose, never make duplicate toolbar or panel APIs.
- [`packages/ui/tw.tsx`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/tw.tsx): `@expo/html-elements` semantics, `Uniwind` native, `react-native-css` on Next.js web. The same `className` API works through platform adapters; it does *not* mean web CSS can style an arbitrary SwiftUI property.
- [`NativeSlot.native.tsx`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/NativeSlot.native.tsx): Expo UI `RNHostView` nested inside `Host`, bridging existing styled RN components into iOS SwiftUI and Android Compose containers.
- [`FieldGroup.native.tsx`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/FieldGroup.native.tsx), [`List.native.tsx`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/List.native.tsx), [`Collapsible.native.tsx`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/Collapsible.native.tsx): platform-native grouped controls. Compose LazyColumn cannot be measured inside an unbounded parent ScrollView.
- [`adaptive-panes`](https://github.com/mikevocalz/moyolearn/tree/main/packages/ui/adaptive-panes), [`adaptive-navigation.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/adaptive-navigation.ts): existing shared pane/Inspector geometry, resize and navigation behavior; `unstable-split-view` is deferred by the code, not used as production renderer.
- [`reserved-regions.native.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/ui/reserved-regions.native.ts) and [`apps/mobile/modules/reserved-regions`](https://github.com/mikevocalz/moyolearn/tree/main/apps/mobile/modules/reserved-regions): existing Expo Modules 2 bridge reading Android WindowManager FoldingFeature (including multiple folds) and Apple reserved regions.
- Moyo has `@metavr/layout-compat` / `@metavr/layout-window-compat` installed. They concern Meta XR spatial layout and must be verified before use; they do **not replace** WindowManager for physical Android fold/hinge geometry.
- [`packages/theme/tokens.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/theme/tokens.ts) generates Tailwind v4 web and native theme CSS; hosts may select different tokens without changing the underlying component source.

## Proposed independent packages and dependencies

```text
nitro-forge (independent repository)
  packages/
    native-ui/                  # @nitro-forge/native-ui, neutral semantics, forms and Expo UI adapters
    adaptive-layout/            # @nitro-forge/adaptive-layout, panes + hinge geometry + optional Meta XR adapter
    editor-ui/                  # @nitro-forge/editor-ui, ForgeWorkspace + Inspector, toolbars etc
    renderer-skia/              # @nitro-forge/renderer-skia, v3 Graphite, may depend on RN WebGPU
    ignition/ and 7 engines/    # NO UI/Expo dependencies; remain portable and headless

moyolearn/packages/ui
  adapter/re-export            # SAME neutral sources, Moyo brand tokens and business-specific UI
```

Explicit dependency rule: `native-ui → (Expo UI, RN)`; `adaptive-layout → native-ui + geometry providers`; `editor-ui → both and typed host engine ports`; `renderer-skia → Skia v3`. Engines never import any of these. There is no `nitro-forge -> @acme/ui` dependency. Moyo must not copy or fork the neutral components after extraction; it imports the independently versioned package. Preserve platform entrypoints with native and web implementations.

## Exact extraction workstream roster

| ID | Responsible expertise | Files and deliverable | Prerequisites | Exit evidence | Status |
| --- | --- | --- | --- | --- | --- |
| UI-01 | Design-system maintainer | Audit `@acme/ui` exports for product-neutral vs Moyo-identity components. Write mapping matrix and protect existing imports. | Moyo source review | Typecheck Moyo before/after; public export diff | PLANNED |
| UI-02 | SDK architect | Introduce `@nitro-forge/native-ui` with platform exports and host theme contract, no Moyo dependencies. | UI-01, PR #2 | standalone import from Expo and Next.js, tarball test | PLANNED |
| UI-03 | Expo native engineer | Extract and test `NativeSlot`, `FieldGroup`, `List`, `Collapsible`, `Host/RNHostView` composition. | UI-02 | SwiftUI/Compose device screenshot and accessibility logs | PLANNED |
| UI-04 | RN Web engineer | Browser equivalents using same semantic API + accessible HTML via RN Web and `@expo/html-elements`. | UI-02 | desktop/tablet/mobile browser, SSR/hydration/keyboard | PLANNED |
| UI-05 | Tailwind theme engineer | Token contract, native Uniwind and Next.js react-native-css adapters, theme injection and v4 compile. | UI-02 | two host themes, no hardcoded token values, visual tests | PLANNED |
| UI-06 | Foldable/geometry engineer | Extract pure `AdaptivePanes` geometry and reserved-region contracts. Keep native module bridge in adapter. | UI-02, full pinned fold skill | exact 18 scenarios, off-origin multi-hinge fixtures | PLANNED |
| UI-07 | Native/Meta XR engineer | Adapter for Jetpack WindowManager + Apple reserved regions, independently verify Meta spatial layout SDK in XR host. | UI-06 | foldable device + XR simulator/hardware when available, no fabricated angle | PLANNED |
| UI-08 | Input/accessibility engineer | Touch/Pencil/mouse/keyboard/screen-reader policies; stable focus/IME while panels move. | UI-03, UI-04 | RN accessibility tests, visual focus/video evidence | PLANNED |
| UI-09 | Moyo integration owner | Replace neutral Moyo internals with `@nitro-forge/native-ui` imports/re-exports; keep brand/shell in Moyo. | UI-02..UI-08, released package | Moyo Expo/Next.js builds and original screens parity | PLANNED |
| UI-10 | QA/release reviewer | Run Storybook, RN/Next.js target matrix, semantic labels, fold/tablet device suite, regression/perf. | all | commit-tied CI+device reports | PLANNED |

## Mandatory skills and evidence
- [Expo overview](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md), [Expo UI](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-ui/SKILL.md), [Expo native UI](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-native-ui/SKILL.md), [design system](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-design-system/SKILL.md), [module](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-module/SKILL.md).
- [Moyo pinned foldable and tablet skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md): read in full, all 18 scenarios; host navigation rules vs inner pane rules.
- [Meta Layout SDK reference](https://github.com/meta-quest/agentic-tools/blob/3a8553d10a5a1bd1bf9beaaa950243fbbed3b9ea/skills/hz-metavrx-layout-sdk/references/react-native-api-reference.md). Verify actual symbol/API rather than assuming an import.
- [Callstack RN performance](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md), [Software Mansion Argent](https://github.com/software-mansion/argent/blob/1a17fd5755247b540b3f812e7e4b736c33c74c40/packages/skills/skills/argent-device-interact/SKILL.md), [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md), [Impeccable](https://github.com/pbakaus/impeccable/tree/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285) for semantics and design drift.

## Constraints and anti-regressions
- Shared editor UI uses actual responsive `@expo/ui` native views and cross-platform semantics. One component source, not separate web and native redesigns; platform-specific adapters are permitted where APIs differ.
- On Moyo native foldable/tablet: host keeps physical-right global navigation (including RTL), content panes respond to usable regions; on Moyo web: host keeps web header/navigation. **Do not impose either host navigation on NitroForge SDK users.**
- A measured narrow pane can collapse without destroying the Rust document, selection or active command. `react-freeze` does not stop GPU workers; pause hidden stages independently.
- React Native Expo UI `List` is not a replacement for virtualized long data lists. On Android avoid nested Compose LazyColumn in unbounded RN scrollers.
- Expo's Universal UI and platform-specific capabilities vary by SDK: pin and inspect actual installed exports, avoid using examples from future versions in production code.
- No raw HTML feature UI or extra WebView editor shells; desktop web uses React Native Web semantic wrappers through the same package API.

## Review/merge gates
- Source-neutral extraction covered by a separate Moyo PR; license/provenance and API review before code moves.
- All original Moyo routes, themes and editor flows remain green in Expo and Next.js.
- Native iOS/Android, browser mobile/tablet/desktop, iPad resize and Surface Duo verified; SSR and keyboard/RTL measured.
- The same package build works from a clean external example app; no accidental Moyo-only workspace aliases.
- No implementation was performed by adding this specification, and all workstreams are NOT RUN until linked evidence is provided.
