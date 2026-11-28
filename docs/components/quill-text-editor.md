---
name: "QuillTextEditor"
namespace: "@nitro-forge"
subpath: "@/components/forge/text-editor"
tier: 1
docs: "handwritten"
platforms: []
category: "input"
tokens: ["--color-accent", "--color-paper", "--color-paper-text", "--color-paper-text-muted", "--color-text-muted", "--font-editorial", "--radius-control", "--radius-paper", "--shadow-page", "--spacing-fixed-element", "--spacing-fixed-inset", "--spacing-fixed-page", "--spacing-group", "--spacing-target"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/forge-icon", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider"]
a11yStatus: "reviewed-fail"
---

# QuillTextEditor

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

A writing surface for Quill documents, supplied through the stage slot. It keeps a local draft in a Zustand store and writes one atomic `replaceRange` edit through `apply` on Apply text or `flush()`. An outside edit during a draft raises a conflict and keeps the draft.

## Install

- Package: `@nitro-forge/quill-text-editor` (registry item)
- Import: `import { QuillTextEditor, type QuillTextEditorHandle } from '@/components/forge/index';`
- Peers: `react` >=19, `react-native` >=0.81, `zustand` 5.1.0
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nitro-forge/forge-directions`; `@nitro-forge/forge-icon`; Quill engine document supplying `apply` and `reload` (engine facade, deferred)
- Command: `npx shadcn@4.23.0 add @nitro-forge/quill-text-editor`
- Installs: `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/text-editor.tsx`, `components/forge/text-diff.ts`

## Props

Extends: Ref handle `QuillTextEditorHandle`: `flush(): Promise<void>`, `isDirty(): boolean`.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| state | `unknown` | none | yes | Quill `describe` data. |
| apply | `(op: string, payload?: unknown) => Promise<unknown>` | none | yes | Engine command port. |
| reload | `() => Promise<void>` | none | yes | Refresh host state after a write. |
| theme | `"dark" \| "light"` | `"dark"` | no | Selects `workspaceThemes`. |
| density | `WorkspaceDensity` | `"standard"` | no | Chrome only; never manuscript type or page geometry. |
| documentTitle | `string` | none | no | Declared in the interface; the file does not read it. |

## Variants

### width

| Value | Effect |
|---|---|
| under 600 | Smaller padding; manuscript 17 pt on 29 line height. |
| 600 and over | Manuscript 19 pt on 34 line height, max width 792. |

### density

| Value | Effect |
|---|---|
| `comfortable` | Adds `min-h-12 min-w-12` to the button. |

## States

| State | How it is set | What the code does |
|---|---|---|
| Clean | draft equals base | "Up to date"; Apply disabled. |
| Dirty | text differs | "Draft changes"; Apply primary. |
| Busy | `flush` running | "Applying…", button loading, input not editable. |
| Conflict | engine changed under the draft | Danger Banner and "Discard draft and load latest document"; Apply disabled. |
| Opening | `state` falsy | Input not editable; flush throws "The document is still opening". |

### Motion

None authored; `ForgeIcon` always gets `reducedMotion`.

## A11y

- TextInput `accessibilityLabel="Essay text"`.
- Apply button `aria-label="Apply essay text"`; discard button `aria-label="Discard draft and load latest document"`.
- Button target `scale.size.target`.
- Android uses the `serif` font; other platforms Georgia.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N02 1.4.3: placeholder paperMuted #797F8D on #FFFEFC 3.98:1 in both schemes (text-editor.tsx:151)
- Failing: N01 1.4.3: word count muted on stage mat 4.01:1 in light (text-editor.tsx:140)

## Example

```tsx example=quill-text-editor
import { useRef } from 'react';
import { QuillTextEditor, type QuillTextEditorHandle } from '@/components/forge/index';

export function Demo() {
  const ref = useRef<QuillTextEditorHandle>(null);
  return <QuillTextEditor ref={ref} state={null} apply={async () => ({ data: null })} reload={async () => {}} />;
}
```

## Do/Don't

### Do

- Call `ref.current.flush()` before save or export so the draft reaches the engine.
- Check `isDirty()` before opening another document over the draft.
- Pass `apply` that supports `describe` and `replaceRange`.

### Don't

- Do not edit the engine behind the editor while a draft is open; it raises a conflict.
- Do not expect `density` to change manuscript type.

### Notes

- `platforms` lists only `android` because that is the only platform the file names (`Platform.OS === "android"` font branch). The editor runs wherever React Native runs.
