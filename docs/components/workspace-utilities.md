---
name: "WorkspaceUtilities"
namespace: "@nitro-forge"
subpath: "@/components/forge/app-manifest"
tier: 1
docs: "handwritten"
platforms: []
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "reviewed-pass"
---

# WorkspaceUtilities

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

`APP_MANIFESTS` gives each of the 11 studios a task line, detail, glyph id and category for launchers. `jsonProblem` and `jsonFaultOffset` turn a JSON parse failure into a plain sentence and an offset. Not components.

## Install

- Package: `@nitro-forge/workspace-utilities` (registry item)
- Import: `import { APP_MANIFESTS } from '@/components/forge/app-manifest';`
- Peers: none
- Requires: `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it)
- Command: `npx shadcn@4.23.0 add @nitro-forge/workspace-utilities`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/app-manifest.ts`, `components/forge/json-problem.ts`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `APP_MANIFESTS` | `Record<Studio, {task, detail, glyph, category}>` |  |  | 11 studios. |
| `jsonProblem(text, error?)` | `string` |  |  | Plain-words parse failure. |
| `jsonFaultOffset(text)` | `number` |  |  | Offset of the fault. |

## Variants

none

## States

none in code.

### Motion

None.

## A11y

- Not applicable. Non-visual.
- Review status: reviewed-pass, reviewed, no failures found in the source read. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=workspace-utilities
import { APP_MANIFESTS } from '@/components/forge/app-manifest';

export const label = APP_MANIFESTS.quill.task;
```

## Do/Don't

### Do

- Use `glyph` ids that exist in `glyphIds` (47 drawn).
- Use `jsonProblem` for import error messages.

### Don't

- Do not assume a glyph id renders because it is in the catalog of 1,463 reserved ids.
- Do not add a studio without a manifest row; the record type requires one.
