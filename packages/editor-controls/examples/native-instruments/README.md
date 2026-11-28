# Editor control demos from NYC-Tron UI

These 27 screens came from NYC-Tron UI
([mikevocalz/NYC-Tron-UI](https://github.com/mikevocalz/NYC-Tron-UI)) at commit
[`5a1ea4db`](https://github.com/mikevocalz/NYC-Tron-UI/tree/5a1ea4db/examples/native-instruments),
directory `examples/native-instruments`. They were the Tron Lab app's demos of
the editor controls that now live in this package. NYC-Tron UI is MIT licensed,
like this package.

The only change from that commit is the import specifiers:

- `@nyc-tron/ui/components/forge/<path>` became `@nitro-forge/editor-controls/<path>`.
- Tron's general components (`Button`, `TabBar`, `Select`) are still imported
  from `@nyc-tron/ui`.
- `P3DiscDemo.tsx` still imports `@nyc-tron/native-controls/DisplayP3DiscLayer`.

| Group | Files |
| --- | --- |
| Canvas | `CanvasWorkbenchDemo` (tabs for `CanvasNavigationDemo`, `GpuCanvasDemo`) |
| Photo | `PhotoWorkbenchDemo` (tabs for `PhotoDevelopDemo`, `PhotoCatalogDemo`, `PhotoWorkflowDemo`, `PhotoMasksDemo`) |
| Motion | `MotionWorkbenchDemo` (a select over `MotionSettingsDemo`, `MotionQueueDemo`, `MotionCurvesDemo`, `MotionTimelineDemo`, `CompositionTreeDemo`, `MotionPathDemo`, `MotionEffectsDemo`, `MotionExpressionDemo`, `MotionNodeGraphDemo`) |
| Color | `ColorManagementDemo`, `ColorAdjustmentsDemo`, `P3DiscDemo` |
| Layers and selection | `ArtboardDemo`, `LayerBlendDemo`, `LayerTreeDemo`, `MaskClipDemo`, `MultiSelectionDemo`, `SelectionBoundsDemo` |

In Tron, the canvas, photo, motion, color management, color adjustments and P3
screens were tabs of the library acceptance entry
(`examples/native-instruments/LibraryAcceptance.tsx`). The layer and selection
demos were rendered only by Tron's Playwright fixtures under
`packages/ui/tests/browser/fixtures/`. No Maestro flow opened any of them.

## Status

These files are not wired into a Forge app, a Playwright fixture or CI yet.

`tsconfig.json` here typechecks them against this package's sources (through the
package's own `exports`) and the installed `@nyc-tron/ui`:

```bash
corepack pnpm --dir packages/editor-controls exec tsc --noEmit -p examples/native-instruments/tsconfig.json
```

`P3DiscDemo.tsx` is excluded from that check because this package does not
depend on `@nyc-tron/native-controls`.
