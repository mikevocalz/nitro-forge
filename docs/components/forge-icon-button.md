---
name: "ForgeIconButton"
namespace: "@nitro-forge"
subpath: "@/components/forge/icons/ForgeIcon"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "input"
tokens: ["--hit-target", "--spacing-fixed-stack", "--spacing-fixed-target"]
registryDependencies: ["@nitro-forge/forge-icon"]
a11yStatus: "reviewed-fail"
---

# ForgeIconButton

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

Pressable wrapper around `ForgeIcon` with a minimum 44 by 44 hit target and hit slop 4. It throws a `TypeError` when `label` is blank, so an unnamed icon button cannot ship. Same source file as `forge-icon`; the split is an authoring choice.

## Install

- Package: `@nitro-forge/forge-icon-button` (registry item)
- Import: `import { ForgeIconButton } from '@/components/forge/icons/ForgeIcon';`
- Peers: same as forge-icon
- Requires: `@nitro-forge/forge-icon`
- Command: `npx shadcn@4.23.0 add @nitro-forge/forge-icon-button`
- Installs: none (the CLI adds them when they are absent)
- Files: none; the item only depends on forge-icon

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| name | `string` | none | yes | Icon id. |
| label | `string` | none | yes | Non-blank; becomes `accessibilityLabel`. |
| onPress | `() => void` | none | no |  |
| selected, disabled, loading | `boolean` | false | no |  |
| size | as `ForgeIcon` | `"default"` | no |  |
| testID | `string` | none | no |  |
| rest | any other `ForgeIcon` prop |  | no | Forwarded. |

## Variants

### inherits

| Value | Effect |
|---|---|
| forge-icon | Same outline, filled and size variants. |

## States

| State | How it is set | What the code does |
|---|---|---|
| Disabled or loading | `disabled` or `loading` | Pressable disabled; loading shows the spin. |
| Pressed | Pressable state | Fed to the icon as `pressed`. |
| Selected | `selected` | `accessibilityState.selected`. |

### Motion

Inherits `forge-icon`.

## A11y

- `accessibilityRole="button"`, `accessibilityLabel={label}`, `accessibilityState {selected, disabled, busy}`.
- Target `minWidth: 44`, `minHeight: 44`, `hitSlop: 4`.
- A blank label throws.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N08 1.4.1, 4.1.2: status is not in accessibilityState or accessibilityValue (ForgeIcon.js:91-93)

## Example

```tsx example=forge-icon-button
import { ForgeIconButton } from '@/components/forge/icons/ForgeIcon';

export const Demo = () => <ForgeIconButton name="save" label="Save" onPress={() => {}} />;
```

## Do/Don't

### Do

- Pass a visible-meaning `label` (`label`).
- Set `loading` from real work so the button blocks double presses.

### Don't

- Do not pass an empty `label`; it throws.
- Do not use an id outside `glyphIds`; the icon renders nothing but the 44 pt target remains.
