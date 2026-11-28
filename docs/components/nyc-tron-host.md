---
name: "NycTronHost"
namespace: "@nitro-forge"
subpath: "@/components/forge/nyc-tron-host"
tier: 1
docs: "handwritten"
platforms: []
category: "shell"
tokens: []
registryDependencies: ["@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/Button", "@nyc-tron/Card", "@nyc-tron/FieldGroup", "@nyc-tron/IconButton", "@nyc-tron/List", "@nyc-tron/SegmentedControl", "@nyc-tron/Select", "@nyc-tron/TabBar", "@nyc-tron/Toolbar", "@nyc-tron/content/KeyValueList", "@nyc-tron/feedback/Badge", "@nyc-tron/feedback/Banner", "@nyc-tron/feedback/EmptyState", "@nyc-tron/feedback/ErrorMessage", "@nyc-tron/files/DropZone", "@nyc-tron/overlays/AnchoredPopover", "@nyc-tron/theme/NightScope"]
a11yStatus: "unverified"
---

# NycTronHost

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

`nycTronStudioUI(host)` builds a `StudioUIComponents` from NYC-Tron UI. The host supplies only platform primitives and three platform parts. Button maps Forge `outline` to NYC-Tron `secondary`; Card forces `surface="raised"` and wraps `NightScope` for `surface="night"`; IconButton applies `targetSize` as min width and height.

## Install

- Package: `@nitro-forge/nyc-tron-host` (registry item)
- Import: `import { nycTronStudioUI } from '@/components/forge/nyc-tron-host';`
- Peers: `react` >=19, `react-native` >=0.81
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nyc-tron/Button`; `@nyc-tron/Card`; `@nyc-tron/FieldGroup`; `@nyc-tron/IconButton`; `@nyc-tron/List`; `@nyc-tron/SegmentedControl`; `@nyc-tron/Select`; `@nyc-tron/TabBar`; `@nyc-tron/Toolbar`; `@nyc-tron/content/KeyValueList`; `@nyc-tron/feedback/Badge`; `@nyc-tron/feedback/Banner`; `@nyc-tron/feedback/EmptyState`; `@nyc-tron/feedback/ErrorMessage`; `@nyc-tron/files/DropZone`; `@nyc-tron/overlays/AnchoredPopover`; `@nyc-tron/theme/NightScope`
- Command: `npx shadcn@4.23.0 add @nitro-forge/nyc-tron-host`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/nyc-tron-host.tsx`, `components/forge/nyc-tron-options.ts`

## Props

Extends: Argument type `NycTronHostParts`. Returns the 27-slot object.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| View, Text, Pressable, ScrollView, TextInput, Image | host primitives | none | yes |  |
| Select | host part | none | yes |  |
| TokenScope | host part | none | no |  |
| ActionMenu | `HostActionMenu` | none | yes | `@nyc-tron/expo-controls/NativeActionMenu` in the Expo host. |
| NativePopover | `ComponentType<PopoverProps>` | none | yes |  |
| GroupedSelect | `ComponentType<SelectProps>` | none | yes | Fed by `studioDropdownGroups`. |

## Variants

none

## States

| State | How it is set | What the code does |
|---|---|---|
| Menu title | NYC-Tron menus have no title row | Trigger label names the menu: `triggerLabel ?? title ?? "Actions"`. |
| Popover placement | prop `placement` | Ignored; NYC-Tron measures the usable region. |

### Motion

None.

## A11y

- Button passes `selected` as `accessibilityState.selected`.
- Menu and Popover derive `accessibilityLabel` from the trigger label and title.
- Review status: unverified, not reviewed or not reviewable from source. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=nyc-tron-host
import { View, Text, Pressable, ScrollView, TextInput, Image } from 'react-native';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativePopover } from '@nyc-tron/expo-controls/NativePopover';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { nycTronStudioUI } from '@/components/forge/nyc-tron-host';

export const studioUI = nycTronStudioUI({
  View, Text, Pressable, Image, Select, ActionMenu: NativeActionMenu, NativePopover, GroupedSelect: Select,
  ScrollView: ScrollView as never, TextInput: TextInput as never,
});
```

## Do/Don't

### Do

- Pass NYC-Tron `Select` for both `Select` and `GroupedSelect` as the Expo host does.
- Add a `TokenScope` (Uniwind `ScopedVariables`) on native so Prism panels can scope tokens.

### Don't

- Do not add Forge copies of Button or Card; this file is the only mapping (decision 1).
- Do not rely on `tone`; the host ignores it and colour comes from theme tokens.

### Notes

- UNVERIFIED: the web host `apps/studio-preview/src/studio-ui.tsx` was not read.
