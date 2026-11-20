---
name: "PersonaComposer"
namespace: "@nitro-forge"
subpath: "@/components/forge/persona-composer"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "forge"
tokens: ["--border-width-hairline", "--font-mono-plain", "--font-weight-bold", "--font-weight-semibold", "--radius-card", "--radius-control", "--shadow-segment-active", "--spacing-element", "--spacing-fixed-rail", "--spacing-fixed-status", "--spacing-group", "--spacing-inset", "--spacing-section", "--spacing-stack", "--spacing-target", "--text-body", "--text-label", "--text-title"]
registryDependencies: ["@nitro-forge/forge-icon", "@nitro-forge/instrument-system", "@nitro-forge/persona-model", "@nitro-forge/studio-gesture", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/DragGrabHandle"]
a11yStatus: "reviewed-fail"
---

# PersonaComposer

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

A form for naming a persona, ordering its instrument rail, choosing capabilities and surfaces, previewing the manifest for the current surface, then saving, exporting, importing or removing through a `PersonaStore`.

## Install

- Package: `@nitro-forge/persona-composer` (registry item)
- Import: `import { PersonaComposer } from '@/components/forge/persona-composer';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nitro-forge/forge-icon`; `@nitro-forge/instrument-system`; `@nitro-forge/persona-model`; `@nitro-forge/studio-gesture`; `@nyc-tron/DragGrabHandle`; `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it)
- Command: `npx shadcn@latest add @nitro-forge/persona-composer`
- Installs: `react-native-svg@15.16.0`, `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/persona-composer.tsx`, `components/forge/persona-composer-model.ts`

## Props

Extends: Also exports `ComposerGlyph` (`more`, `chevron-left`, `chevron-down`, `chevron-up`). Name limit `PERSONA_NAME_MAX` 40.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| store | `PersonaStore` | none | yes | Every save, import and removal goes through it. |
| theme | `"dark" \| "light"` | `"dark"` | no | Dark wraps the body in `NightScope`. |
| colors | `WorkspaceColors` | `prismThemes[theme]` | no |  |
| onExportPersona | `(json, persona) => Promise<"copied" \| "shared">` | shows JSON in a field | no | Host copy or share. |

## Variants

### layout by width

| Value | Effect |
|---|---|
| wide | Width >= 1000 (`COMPOSER_WIDE`). |
| single | Between 600 and 1000. |
| phone | Under 600 (`COMPOSER_PHONE`); instrument and capability grids fold into disclosures. |

### theme

| Value | Effect |
|---|---|
| `light` | Own segment classes on web (`LIGHT_SEGMENTS`). |

## States

| State | How it is set | What the code does |
|---|---|---|
| Save blocked | `saveBlocker(draft)` | Reason shown. |
| Notice | save, import, export, remove | Banner tone success, danger or info. |
| Import open | Import button | Multiline field "Persona JSON to import". |
| Built-in | persona `builtIn` | Not removable or exportable; caption explains. |
| Reorder | drag, Move up, Move down | Live announcement of the new position. |

### Motion

None authored.

## A11y

- Name field `accessibilityLabel="Persona name"`; import and export fields labelled.
- Toggles: `accessibilityRole="button"` with `accessibilityState.selected` or `expanded`.
- Lists: `accessibilityRole="list"` with `listitem` rows; headings with `aria-level`.
- Reorder by Move up and Move down buttons (`aria-label="Move <name> up"`), screen reader and drag.
- Web live region; iOS and Android use `announceForAccessibility`.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N06 1.4.11: field borders c.line 1.16 to 1.78:1 against field ground and 1.37 to 1.57:1 against the panel (persona-composer.tsx:195,405,426)

## Example

```tsx example=persona-composer
import { PersonaComposer } from '@/components/forge/persona-composer';
import { createPersonaStore } from '@/components/forge/persona-store';

const store = createPersonaStore({ surface: 'web' });
export const Demo = () => <PersonaComposer store={store} />;
```

## Do/Don't

### Do

- Pass `onExportPersona` to use the clipboard or share sheet.
- Use the store from the open document so saves persist with it.

### Don't

- Do not offer remove or export for built-in personas; the store refuses them.
- Do not hide capabilities with `engine: "not-in-engine"`; the form keeps them selectable and tags them.
