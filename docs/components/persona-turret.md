---
name: "PersonaTurret"
namespace: "@nitro-forge"
subpath: "@/components/forge/persona-turret"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "forge"
tokens: ["--border-width-hairline", "--color-accent", "--font-weight-bold", "--radius-control", "--spacing-element", "--spacing-inset", "--spacing-stack", "--text-body", "--text-label", "--text-micro"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/persona-model", "@nitro-forge/studio-gesture", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider"]
a11yStatus: "reviewed-fail"
---

# PersonaTurret

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

The design studio persona switcher: a four-stop machined dial with a detent per persona. Drag or arrow keys preview, release or Enter commits, Escape cancels. Also exports the hooks `useStudioTextScale`, `useForgeRenderPrefs`, `useTurretShortcut` and `documentRtl`.

## Install

- Package: `@nitro-forge/persona-turret` (registry item)
- Import: `import { PersonaTurret, useStudioTextScale } from '@/components/forge/persona-turret';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0, `react-native-reanimated` >=4.7.1 <5 (native motion file)
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nitro-forge/forge-directions`; `@nitro-forge/persona-model`; `@nitro-forge/studio-gesture`; `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it)
- Command: `npx shadcn@4.23.0 add @nitro-forge/persona-turret`
- Installs: `react-native-reanimated@^4.7.1`, `react-native-svg@15.16.0`, `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/persona-turret.tsx`, `components/forge/turret.ts`, `components/forge/turret-motion.tsx`, `components/forge/turret-motion.native.tsx`, `components/forge/turret-motion-types.ts`

## Props

Extends: Also exports `TURRET_SIZE`, `turretBoxWidth(textScale, count)`, `turretCopy`, `BUILT_IN_PERSONAS`.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| personas | `readonly PersonaSpec[]` | none | yes |  |
| surface | `PersonaSurface` | none | yes | Stops are `personasOn(personas, surface)`. |
| activeId | `string` | none | yes | Committed persona. |
| onSwitch | `(personaId) => void` | none | yes | Once per committed switch; never touches the document. |
| onEffect | `(effect: TurretEffect) => void` | none | no | Haptics and sound hook. |
| onAnnounce | `(text) => void` | own node | no | Web host status node. |
| onDismiss | `() => void` | none | no | Escape with no preview open. |
| autoFocus | `boolean` | falsy | no |  |
| rtl | `boolean` | document or `I18nManager` | no |  |
| direction | `ForgeDirectionId` | `"workbench"` | no |  |
| scheme | `ForgeScheme` | `"dark"` | no |  |
| colors | `WorkspaceColors` | none | no | Only `accent` is used. |
| disabled | `boolean` | falsy | no |  |
| handle | `Ref<PersonaTurretHandle>` | none | no | `cancel()`, `focus()`. |

## Variants

### direction

| Value | Effect |
|---|---|
| `workbench` | Detent travel 120 ms, curve (0.22, 1, 0.36, 1). |
| `optics` | 200 ms, (0.16, 1, 0.3, 1). |
| `atelier` | 280 ms, (0.25, 1, 0.5, 1). |

## States

| State | How it is set | What the code does |
|---|---|---|
| Peeking | drag or key | Indicator moves; commit on release, Enter or digit shortcut. |
| End stop | drag past first or last stop | Two-beat nudge, or an opacity pulse under Reduce Motion. |
| Disabled | `disabled` | "Persona switching waits for the engine to finish". |
| No stops | no persona runs on this surface | "No persona runs on this device". |

### Motion

`forgeFeedbackMotion`: press 80 ms scale 0.96, end-stop beat 60 ms by 3 degrees, commit rim 200 ms peak opacity 0.9. Reduce Motion sets travel to 0 ms. Web uses a CSS transition and one Web Animation; native uses Reanimated on the UI thread.

## A11y

- Container `accessibilityRole="radiogroup"`; each stop `accessibilityRole="radio"` with `accessibilityState.checked` and `aria-checked`.
- Ring `accessibilityRole="adjustable"`.
- Announcements: `AccessibilityInfo` on native, a hidden live region on web.
- Reads reduce motion, reduce transparency, contrast, forced colors, text scale; shortcut tags only for a fine pointer on web.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N10 iOS 44 pt: stop targets scale to 0.85 of 44, 37.4 pt, in the narrow ring layout (persona-turret.tsx:399, turret.ts:150)

## Example

```tsx example=persona-turret
import { PersonaTurret, BUILT_IN_PERSONAS } from '@/components/forge/persona-turret';

export const Demo = () => (
  <PersonaTurret personas={BUILT_IN_PERSONAS} surface="web" activeId="vector" onSwitch={() => {}} />
);
```

## Do/Don't

### Do

- Size the host panel with `turretBoxWidth(useStudioTextScale(), count)`.
- Call `handle.cancel()` on Android Back or a closing sheet.

### Don't

- Do not let `onSwitch` mutate the document; personas hold none.
- Do not mount the native motion file without `react-native-reanimated`; the import is unconditional (UNVERIFIED by build).
