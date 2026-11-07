# Suite design brief v1: implementation audit

2026-11-07. Source: user-supplied “Nitro Forge — Suite UI GUI Design System Prompt (v1).md”. The source document is reference material. Its proposed commands, agents, package names and platform claims are not automatic changes to repository contracts.

## Current foundation

| Brief requirement | Inspected implementation | Remaining work |
| --- | --- | --- |
| Shared studio chrome | `packages/studio-workspace/src/index.tsx`, `ui.tsx`, `nyc-tron-host.tsx` | Map title, contextual tools, dock, inspector and truthful status across each real studio screen. Reuse NYC-Tron controls. |
| Semantic tokens | `packages/studio-workspace/src/theme.ts`, `theme.css`, `theme.native.css`, `build-theme.mjs` | Consolidate neutral roles and contrast variants; distinguish studio accent overrides from the current Prism neutral overrides. Keep app-owned tokens out of the reusable library. |
| Three visual directions | `packages/studio-workspace/src/forge-directions.ts`, `design/DIRECTION.md`, `docs/ux/FORGE_2046_DESIGN_REVIEW_PLAYBOOK.md` | Reuse Workbench/Optics/Atelier as the comparison set. Existing direction code is not proof of all requested iPad captures. |
| Saved design workspaces | `packages/studio-workspace/src/persona-store.ts`, `persona.ts`, `persona-composer-model.ts` | Verify save/import/export and continuity through the real design editor; preserve engine undo and document identity. |
| Native motion | `packages/studio-workspace/src/turret-motion.native.tsx` | Existing turret motion uses Reanimated shared values/styles. Audit other interactions individually; no suite-wide UI-thread claim yet. |
| Native menus/popovers | `packages/studio-workspace/src/nyc-tron-host.tsx` | Existing host injects ActionMenu, NativePopover and GroupedSelect. Verify each platform adapter; do not redraw these inside Forge. |
| Per-studio packages | Existing engine packages and `@nitro-forge/studio-workspace` | Distinguish headless engine packages from independently mountable editor packages. Do not rename or duplicate them merely to match example names. |
| Brand isolation | `packages/studio-workspace/src/app-manifest.ts`, labels in workspace source | Inventory display labels separately from stable engine IDs, serialized formats, routes and release metadata. Rebrand proof must preserve existing document compatibility. |
| Reference research | `docs/ux/DESIGN_REFERENCE_AUDIT.md`, `design/research/affinity-studio-switch.md`, `docs/ux/MOBBIN_REVIEW.md` | Existing web/iPhone references do not establish the requested iPad build/device/orientation/version matrix. Capture missing evidence explicitly. |
| Current reusable library | NYC-Tron PR54, 329 library-scope implementation checkpoints | Review and acceptance still precede a new release. Forge remains pinned to published alpha.4 in `tooling/nyc-tron.json`; new source is not silently treated as released. |

## Contract decisions for applying the brief

- NYC-Tron stays the reusable control owner. The brief's `@forge/ui` and `@forge/ui-native` examples map to existing NYC-Tron packages and Forge adapters; they do not create a second library.
- Preserve the existing package scope and install contracts until a deliberate migration is implemented. `StudioShell` is an API proposal, not an import that currently exists.
- Separate document tools from app navigation. A left editing rail does not replace the physical-right native tablet/foldable/headset navigation policy. Width alone never selects the hardware shell.
- Preserve 4px Studio chrome and established app window/orientation contracts. iPad portrait does not authorize a global navigation change.
- Keep in-document Vector/Pixel/Layout/Sketch persona switching inside the design editor. Do not add a suite-wide studio switcher.
- Treat compact/standard/comfortable as a proposed density contract. Existing documents also use compact/comfortable/presentation. Preserve saved values and define an explicit migration before changing persisted presets. Presentation behavior is not silently renamed into density.
- Visible compact controls retain accessible input targets and Dynamic Type behavior. Desktop density does not remove keyboard, switch or screen-reader paths.
- Haptics respect the existing user opt-out and OS policy. Precision/frame scrubbers retain cancellation and exact final commit; inertial release is opt-in by domain, not a global slider rule.
- The brief's normalized spring damping values are design ratios, not unquestioned native API arguments. Bind them to installed Reanimated types before implementation.
- Keep actual engine results and measurements. A quality aspiration or named reviewer role is not evidence of an award, a performance number, independent review or device pass.

## Verified external reference limits

- [Affinity's official iPad page](https://www.affinity.studio/ipad-app) supports touch/Pencil and one-file design/photo/layout workflows. It does not establish the brief's exact app version, launch date, 11in/13in screenshots or measured performance.
- [Figma's mobile guide](https://help.figma.com/hc/en-us/articles/1500007537281-Guide-to-the-Figma-mobile-app) describes file access, prototypes/mirroring and iPad FigJam. Do not attribute the desktop UI3 properties editor to the iPad app without direct evidence.
- [Apple's Logic Pro for iPad guide](https://support.apple.com/en-ca/guide/logicpro-ipad/dev780a0e575/ipados) supports iPad-specific professional editing and Pencil automation. It is not a measurement of Forge performance.
- [Adobe's Spectrum 2 introduction](https://adobe.design/ideas/introducing-spectrum-2) supports shared design-system foundations across products. [Fluent 2](https://fluent2.microsoft.design/get-started/whatisnew) explicitly distinguishes system and platform changes. Neither is permission to copy trade dress or infer unseen tablet layouts.

No third-party screenshots or private design-pack content were copied into this public repository. Follow-up research downloaded 32 official iPad gallery previews for 16 exact app matches into a private local evidence folder. A research agent visually reviewed the first preview for all 16 apps and additional previews where noted in IPAD_REFERENCE_OBSERVATIONS.md. These are low-resolution marketing/gallery images, not native captures; screenshot build versions and physical device sizes remain unknown. Creative Cloud has no exact match in this query and remains unresolved. No App Store review study, native iPad run or device/performance test was performed. The reference index records those gaps.

## Private pack located

The first search of skill roots did not find the named pack. A subsequent targeted Downloads search found the private `forge-designer-pro` adaptation and its ZIP. The skill and its relevant roster, research, studio-discovery and design references were read locally. The earlier request for its location is resolved. No private files, implementation code, commercial assets or ZIP content enter this public repository. Placeholder package paths inside the pack are interpreted through the actual repository ownership rules.

## Delivery sequence

1. Reconcile the brief with existing ownership and evidence: this audit and the reference index. This is an audit checkpoint, not completion of the brief's Phase 0.
2. Finish iPad reference capture and actual user-job research. Record app/build, device size, orientation, source, observation versus inference and allowed asset use. Keep iPhone pattern mining separate. Do not turn proposed jobs into claimed interviews or reviews.
3. Compare the located private pack privately with the current system. Produce public, original token contracts and three real-task screen comparisons. Preserve the existing direction decision unless evidence or user direction changes it.
4. Consolidate host-owned tokens and density through existing NYC-Tron slots. Wire native overlays and motion per interaction. Keep native resources above layout wrappers and typed engine mutations below Forge adapters.
5. Prove the design editor's real select/edit/undo/save/reopen workflow, then independently mount the remaining studio editors. Preserve separate app entry and serialized document contracts.
6. After user implementation review, run type, source, browser and native acceptance, then physical accessibility/performance checks. Missing device evidence remains open. Release and consumer pin changes follow acceptance.
7. Prove rebranding in an isolated throwaway checkout without rewriting stable engine protocol IDs or existing documents. Do not rename the working repository as a demonstration.

Each implementation batch records its changes, checks and limits, then commits and pushes. The existing native player worktree remains preserved. No baseline player files, dependencies, release pins or app configuration changed in this audit. A separately owned web-preview server and headless browser processes rendered the existing three directions at 1194 × 834; these captures are web evidence only.
