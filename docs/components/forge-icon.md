---
name: "ForgeIcon"
namespace: "@nitro-forge"
subpath: "@/components/forge/icons/ForgeIcon"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "primitive"
tokens: ["--color-icon", "--color-icon-accent-bright", "--color-icon-cyan", "--color-icon-danger", "--color-icon-muted", "--color-icon-selected", "--color-icon-success", "--color-icon-surface", "--color-icon-warning", "--duration-icon-deselect", "--duration-icon-error", "--duration-icon-hover", "--duration-icon-loading", "--duration-icon-press", "--duration-icon-select", "--duration-icon-success", "--hit-target", "--opacity-disabled", "--scale-icon-press", "--scale-icon-selected", "--size-icon-default", "--size-icon-feature", "--size-icon-hero", "--size-icon-sm", "--size-icon-toolbar", "--size-icon-touch", "--size-icon-xs", "--spring-icon-damping", "--spring-icon-mass", "--spring-icon-stiffness", "--stroke-icon-box", "--stroke-icon-width"]
registryDependencies: []
a11yStatus: "reviewed-fail"
---

# ForgeIcon

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

Shared icon. Idle is a rounded outline, selected a filled silhouette, with a crossfade between them. Renders `react-native-svg` paths or a host Rive artboard through `renderRive`. COVERAGE: the catalog reserves 1,463 ids in 25 categories. 47 glyphs are drawn; 42 of the 1,463 catalog ids resolve to one; 6 drawn glyphs are not catalog ids. `ForgeIcon` returns null for an id without artwork. Do not advertise 1,463 as available.

## Install

- Package: `@nitro-forge/forge-icon` (registry item)
- Import: `import { ForgeIcon } from '@/components/forge/icons/ForgeIcon';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` >=15 (all optional peers; root patches 15.16.0)
- Requires: none
- Command: `npx shadcn@4.23.0 add @nitro-forge/forge-icon`
- Installs: `react-native-svg@15.16.0` (the CLI adds them when they are absent)
- Files: `components/forge/icons/ForgeIcon.js`, `components/forge/icons/state.js`, `components/forge/icons/tokens.js`, `components/forge/icons/glyphs.js`, `components/forge/icons/catalog.js`, `components/forge/icons/ForgeIcon.d.ts`, `components/forge/icons/index.d.ts`, `components/forge/icons/index.js`

## Props

Extends: Helpers: `resolveIconState`, `riveIconInputs`, `getGlyph`, `hasIconId`, `getIconMetadata`, `iconsInCategory`, `searchIcons`. Authored ids (47): home dashboard menu search save file folder undo redo pen pencil brush eraser highlighter hand move pointer lasso rectangle ellipse text image layers comment play pause stop scissors table chart slide pdf video audio music bluetooth check close plus minus share export settings sparkles microphone timeline color-wheel.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| name | `string` | none | yes | Must be one of the 47 `glyphIds` to render. |
| selected, disabled, loading, pressed, hovered | `boolean` | false | no | See States. |
| status | `"idle" \| "success" \| "error" \| "recording"` | `"idle"` | no |  |
| size | `number \| "xs" \| "sm" \| "toolbar" \| "default" \| "touch" \| "feature" \| "hero"` | `"default"` | no | 12, 16, 20, 24, 28, 32, 48; numbers 8 to 256. |
| appearance | `"light" \| "dark"` | `"light"` | no |  |
| color, selectedColor, disabledColor, successColor, errorColor, surfaceColor | `string` | token defaults | no | Per-instance overrides. |
| reducedMotion | `boolean` | false | no |  |
| renderRive | `(inputs) => ReactNode` | none | no | Host Rive hook; no runtime bundled. |
| testID | `string` | none | no |  |

## Variants

### variant

| Value | Effect |
|---|---|
| outline | Idle. |
| filled | Selected. |

### size

| Value | Effect |
|---|---|
| xs 12, sm 16, toolbar 20, default 24, touch 28, feature 32, hero 48 | Pixels. |

## States

| State | How it is set | What the code does |
|---|---|---|
| disabled | `disabled` | Opacity 0.52; color `disabledColor` or muted; no motion. |
| loading | `loading` | 850 ms linear spin loop. |
| success / error / recording | `status` | Success and error recolour; recording is a state value for Rive. |
| pressed | `pressed` | Spring to scale 0.9. |
| selected | `selected` | Crossfade to filled, scale 1.075. |
| hover | `hovered` | State value only; no visual change authored. |

### Motion

Select crossfade 225 ms, deselect 175 ms, `Easing.out(Easing.cubic)`. Press spring stiffness 260, damping 22, mass 0.8. All motion stops under `reducedMotion` or `disabled`. Native driver on. State precedence: disabled, loading, success, error, recording, pressed, selected, hover, idle.

## A11y

- Hidden from assistive tech: `accessible: false`, `aria-hidden`, `importantForAccessibility="no-hide-descendants"`. Name comes from the wrapper (ForgeIconButton).
- Size outside 8 to 256 throws `RangeError`.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N09 1.4.11: default appearance=light ink 1.02:1 on dark workspace base; default accent #6859E8 2.89:1 on dark raised (ForgeIcon.js:29, state.js)
- Failing: N08 1.4.1: status success, error, recording change colour only and the glyph is hidden from assistive tech (state.js)

## Example

```tsx example=forge-icon
import { ForgeIcon } from '@/components/forge/icons/ForgeIcon';

export const Demo = () => <ForgeIcon name="home" selected size="toolbar" appearance="dark" />;
```

## Do/Don't

### Do

- Check `hasIconId` and `glyphIds` before showing an icon name (`name`).
- Tie `loading` and `status` to real operation state; the README forbids timers faking success.

### Don't

- Do not claim 1,463 icons; 47 are drawn.
- Do not rely on `./web` working without react-native-web (UNVERIFIED).

### Notes

- UNVERIFIED: whether the registry will carry the icons as `.tsx`; source is plain `.js` with a hand-written `.d.ts`.
- UNVERIFIED: `./web` resolves to the same file as `./native`, so web needs react-native-web; no web build was read.
- Drift kept as separate tokens (decision 5): icon accent `#6859E8` vs workspace `#6950D1`; icon dark surface `#11131B` vs `#15171D`. `iconColorTokens.successColor` maps to accent, a possible bug left alone (decision 16).
