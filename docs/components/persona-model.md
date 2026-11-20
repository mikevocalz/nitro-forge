---
name: "PersonaModel"
namespace: "@nitro-forge"
subpath: "@/components/forge/persona"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: []
registryDependencies: ["@nitro-forge/instrument-system", "@nitro-forge/workspace-utilities"]
a11yStatus: "reviewed-pass"
---

# PersonaModel

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

Non-visual persona model: 4 built-in personas (vector, pixel, layout, sketch), 11 capabilities (4 backed by Prism ops, 7 marked `not-in-engine`), 7 surfaces, compose, import, export, switch, and a per-document store with a host storage port. Not a component; the template covers components, so this page lists the API.

## Install

- Package: `@nitro-forge/persona-model` (registry item)
- Import: `import { createPersonaStore } from '@/components/forge/persona-store';`
- Peers: `zustand` 5.1.0
- Requires: `@nitro-forge/instrument-system`; `@nitro-forge/workspace-utilities`; `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it)
- Command: `npx shadcn@4.23.0 add @nitro-forge/persona-model`
- Installs: `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/persona.ts`, `components/forge/persona-store.ts`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| createPersonaStore(options) | `{surface, storage?, initialPersonaId?}` | none | yes | Returns a Zustand vanilla store. |
| PersonaStoragePort | `{load, save}` | none | no | Host durable storage (MMKV, file, browser). |
| actions | `switchTo`, `setSurface`, `setContinuity`, `compose`, `importJson`, `exportJson`, `remove`, `clearError` |  |  | On `PersonaStoreActions`. |
| `PERSONA_FORMAT` | `1` |  |  | Export format version. |

## Variants

none

## States

| State | How it is set | What the code does |
|---|---|---|
| Error | failed switch, compose, import, or unreadable saved personas | Plain-words string in store `error`. |

### Motion

None.

## A11y

- Not applicable. Non-visual.
- Review status: reviewed-pass, reviewed, no failures found in the source read. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=persona-model
import { createPersonaStore } from '@/components/forge/persona-store';

export const store = createPersonaStore({ surface: 'iphone' });
```

## Do/Don't

### Do

- Provide a `PersonaStoragePort` to keep user personas.
- Call `setSurface` when a fold opens or a display attaches.

### Don't

- Do not store document data here; personas hold none.
- Do not choose the storage backend in the store; the host does.
