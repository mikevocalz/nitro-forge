---
name: native-adaptive-ui
description: Compose NitroForge Studio screens from NYC-Tron UI's released controls across Expo UI/SwiftUI, Jetpack Compose, Meta spatial, Tailwind v4 and responsive web/tablet/foldable layouts, without a second Forge copy of any control.
---
# NitroForge shared cross-platform native UI skill

## Authoritative source order
1. Read Moyo source: [@acme/ui](https://github.com/mikevocalz/moyolearn/tree/main/packages/ui), `tw.tsx`, `NativeSlot.native.tsx`, `FieldGroup.native.tsx`, `List.native.tsx`, `adaptive-panes/`, `adaptive-navigation.ts`, `reserved-regions.native.ts`.
2. Read [Moyo's pinned foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md) in full, including the 18 acceptance scenarios.
3. Read [Expo overview](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md), [expo-ui](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-ui/SKILL.md), [expo-design-system](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-design-system/SKILL.md), [expo-native-ui](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-native-ui/SKILL.md).
4. For spatial UI, read [Meta Layout SDK React Native API](https://github.com/meta-quest/agentic-tools/blob/3a8553d10a5a1bd1bf9beaaa950243fbbed3b9ea/skills/hz-metavrx-layout-sdk/references/react-native-api-reference.md). It is *Meta XR spatial-window* functionality, not a substitute for Android Jetpack WindowManager folding features.
5. Read `docs/STUDIO_UI.md` (lands with PR #1), Moyo's actual token generation and `docs/ENGINEERING_SKILLS.md`.

## Dependency rules
- Product-neutral controls are owned once by [NYC-Tron UI](https://github.com/mikevocalz/NYC-Tron-UI) and ship as its GitHub Release tarballs (`v0.1.0-alpha.1` is the first). Forge and Moyo both install the release by URL. Forge never creates its own UI package or copy of a control, and never imports Moyo business/auth/brand state into the SDK. A missing control is extracted into NYC-Tron first.
- React Native/Expo provides the shared authoring surface; `@expo/ui` universal `Host` and `RNHostView` preserve SwiftUI-backed iOS and Compose-backed Android native UI where appropriate. Use RN-native semantic controls for features Expo UI does not expose; accessible web implementation from same public API.
- Tailwind CSS v4 is mandatory for styling contracts. Preserve Moyo's existing `Uniwind` on native and `react-native-css` on Next.js web behind its semantic wrappers; don't blindly swap to NativeWind or claim `className` styles an arbitrary SwiftUI modifier.
- Shared tokens for spacing, sizing, typography, surfaces, focus, border, radius, elevation and motion. Hosts inject their own brand palette; NitroForge ships neutral defaults. Use design-system audit; eliminate arbitrary hex, giant gradient hero, emoji menu icon, excessive cards.
- The editor shell owns interior Tool Rail, Inspector and Stage; consuming apps own *global navigation* and auth. Do not force Moyo's right rail into another app.

## Responsiveness and real platform geometry
- Observe **measured host container** and window changes, safe areas, keyboard, pointer/touch/pen capability, RTL and reduced-motion. Width breakpoints are named design tokens, not guessed device models.
- Native ordinary phone can expose a contextual bottom sheet; iPad/Android tablet can show multiple panels; web desktop has dockable panes with keyboard/pointer support; narrow web uses the same semantic feature through responsive RN Web.
- Preserve app-specific policy: Moyo's foldable/tablet has a physical-right global navigation rail including RTL; its web has a header and small-screen bottom tabs. The SDK does not impose that navigation policy.
- **Android**: read full `FoldingFeature` collection from Jetpack WindowManager via tested Expo Modules 2 bridge, include separating zero-width folds and occluding rectangles. Normalize to pane row coordinates after measurement. **Apple**: only use availability-gated UIKit reserved regions/SwiftUI adapters; do not assert unverified Expo API exposure.
- Never fake hinge angles. Distinguish verified hardware family, transient posture, and live usable geometry. Maintain stable document/editor sessions when panes collapse or resize; scope canvas frame loops to pane visibility.
- Host Meta XR SpatialScene/SpatialWindow through verified `@metavr/layout-compat` / `@metavr/layout-window-compat` APIs only where supported. XR compositor panels are not generic 2D screen dimensions.

## Acceptance
- One NYC-Tron release tarball imported by an independent NitroForge sample and by Moyo, verified by the pinned tarball hash rather than screenshots alone.
- iOS SwiftUI native controls and Android Compose native controls, correctly nested `Host`/`RNHostView`, accessible screen reader navigation, input, keyboard/pointer and touch.
- 18 tailored foldable scenarios, actual iPad resizes/Stage Manager, Surface Duo book/tabletop/RTL/multiple hinge fixtures, web browser phone/tablet/desktop, SSR hydration and reduced motion.
- No native lazy list inside unbounded parent scroller (Android Compose measurement crash). Reusable Inspector must never cover the active canvas or become unclosable on compact windows.
- Persist workspace layout state and undo/selection across fold/rotate/resize. Verify real device and browser evidence separately; unavailable device = `NOT RUN`.
