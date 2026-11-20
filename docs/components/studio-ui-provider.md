---
name: "StudioUiProvider"
namespace: "@nitro-forge"
subpath: "@/components/forge/ui"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "shell"
tokens: []
registryDependencies: []
a11yStatus: "reviewed-pass"
---

# StudioUiProvider

## Purpose

**Prerequisite.** This item is the provider. Install it first, then a host such as `nyc-tron-host`.

The slot contract between Studio and the host UI. `StudioUIProvider` puts a `StudioUIComponents` object in context and each wrapper reads its slot and forwards props. With no provider any wrapper throws "Studio requires StudioUIProvider with your application UI components. No substitute UI is installed." No fallback UI exists.

## Install

- Package: `@nitro-forge/studio-ui-provider` (registry item)
- Import: `import { StudioUIProvider, View, Text, Button /* and the other wrappers */ } from '@/components/forge/ui';`
- Peers: `react` >=19, `react-native` >=0.81
- Requires: A `StudioUIComponents` implementation (registry item `nyc-tron-host` builds one from NYC-Tron)
- Command: `npx shadcn@4.23.0 add @nitro-forge/studio-ui-provider`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/ui.tsx`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| components | `StudioUIComponents` | none | yes | 27 slots; 24 required, 3 optional (Popover, NativeDropdown, TokenScope). Table in the Slots section above. |
| children | `ReactNode` | none | yes |  |
| slot props | `Studio*Props` types in `ui.tsx` |  |  | `tone` and `surface` are accepted for older call sites and ignored by the NYC-Tron host. |

## Variants

### Button `variant`

| Value | Effect |
|---|---|
| primary, outline, ghost | NYC-Tron host maps outline to secondary. |

### Button `size`

| Value | Effect |
|---|---|
| sm, md |  |

### Banner `tone`

| Value | Effect |
|---|---|
| info, danger, success, neutral |  |

### Card, KeyValueList `surface`

| Value | Effect |
|---|---|
| page, night | night wraps in `NightScope`. |

### Toolbar `density`

| Value | Effect |
|---|---|
| default, compact |  |

### TabBar `semantics`

| Value | Effect |
|---|---|
| tabs, navigation |  |

## States

| State | How it is set | What the code does |
|---|---|---|
| No provider | wrapper called outside the provider | Throws. |
| Optional slot absent | Popover or NativeDropdown not supplied | Throws a named error; no generic popup is substituted. |
| TokenScope absent | native | Children render unscoped. |
| TokenScope absent | web | `display: contents` view carries the variables. |

### Motion

None.

## A11y

- The wrappers set nothing; `aria-label` and similar props pass through to the host component.
- Review status: reviewed-pass, reviewed, no failures found in the source read. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=studio-ui-provider
import { StudioUIProvider, type StudioUIComponents } from '@/components/forge/ui';

declare const studioUI: StudioUIComponents;
export const Root = ({ children }: { children: React.ReactNode }) => (
  <StudioUIProvider components={studioUI}>{children}</StudioUIProvider>
);
```

## Do/Don't

### Do

- Mount the provider once above every studio component (`components`).
- Supply `Popover` and `NativeDropdown` when you use Prism, which calls them.

### Don't

- Do not expect a default UI; none is installed.
- Do not recreate controls in Forge; NYC-Tron owns them (decision 1).
