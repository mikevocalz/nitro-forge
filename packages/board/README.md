# @nitro-forge/board

**One universal canvas package** for whiteboards, drawing, PDF annotation, PixForge/Prism graphics, slide markup and XR ink. It is **independent of Moyo** and currently **private/draft**; it has not been published as a production SDK.

The board *renders* a document owned by its host. It does not create a second editable QuickDraw document, Yjs CRDT, undo stack, storage provider or collaboration server.

## Composition

| Import | Feature |
| --- | --- |
| `@nitro-forge/board/scene` | Generic bounded vector paths and paint → derived scene, no QuickDraw dependency |
| `@nitro-forge/board/ink` | Pressure-sensitive segments, aspect-preserving input geometry and direct ink-to-scene conversion |
| `@nitro-forge/board/skia` | Pure QuickDraw scene compiler, native pointer normalization and one derived Zustand presentation bridge |
| `@nitro-forge/board/skia/native` | **Skia v3 Graphite** canvas on supported Apple/Android devices, with caller-supplied unsupported/GPU fallback |
| `@nitro-forge/board/native` | Optional Android Viro XR CanvasSurfaces renderer through Nitro v1 |
| `@nitro-forge/board/offline` | Generic local snapshot/revision and save-before-ACK state controller |
| `@nitro-forge/board/offline/mmkv` | Native **MMKV v4** single-key scoped binary persistence and corruption checks (host supplies storage instance) |
| `@nitro-forge/board/offline/yjs` | Adapter to the host's **existing Yjs** document: local autosave, CRDT remote merge, sync receipts and unsaved-state indicator |
| `@nitro-forge/board/offline/sync` | Host-transport-neutral Yjs upload/reconnect coordinator, with exact revision ACKs |
| `@nitro-forge/board` | Original QuickDraw snapshot/diff encoder and Android renderer binding |

The QuickDraw and Zustand packages are **optional peer dependencies**: drawing/graphics consumers can use `/scene` and `/ink` without installing QuickDraw. Nitro v1 and Skia v3 are separate native runtimes; subpath imports avoid loading unsupported native modules on web.

### Generic drawing without QuickDraw

```ts
import { compileUniversalCanvasScene } from '@nitro-forge/board/scene';
import { compileNativeInkScene } from '@nitro-forge/board/ink';

const vector = compileUniversalCanvasScene({
  schemaVersion: 1,
  width: 1024, height: 768,
  elements: [{ id: 'shape-1', path: 'M 10 10 L 100 10 L 100 80 Z',
    color: '#4263EB', mode: 'stroke', strokeWidth: 3 }],
});
const pressureInk = compileNativeInkScene([{
  kind: 'stroke', id: 'ink-1', color: '#E03131', baseWidth: 8,
  points: [{ x: 10, y: 10, pressure: 0.25 },
           { x: 80, y: 45, pressure: 0.75 }],
}]);
// Both are derived scenes; the app's real document still owns the edits.
```

The native Skia Canvas accepts a `SceneResult` and renders **only fully supported scenes**. Unsupported text, fonts, images and unknown records must use the caller's fallback rather than silently disappearing.

### Offline Yjs and MMKV v4, not SQLite

```ts
import { createMMKVBoardStorage } from '@nitro-forge/board/offline/mmkv';
import { createLocalYjsBoardSession } from '@nitro-forge/board/offline/yjs';

const storage = createMMKVBoardStorage(mmkv, {
  scope: organizationId + '/' + learnerId,
});
const saved = createLocalYjsBoardSession({
  documentId: boardId,
  document: boardDoc, // existing host Y.Doc wrapper
  storage,
  subscribeChanges: listener =>
    boardDoc.onRecords((_diff, origin) => {
      if (origin !== 'restore') listener();
    }),
  onPersistenceError: err => showUnsavedWarning(err),
});
await saved.initialize(); // restore previous ink before the canvas is shown
```

The app owns its MMKV instance, identity, permission checks and encryption; the SDK requires a scoped key to prevent shared-tablet learner data leaks. Yjs merges are nondestructive. Failed MMKV writes remain **unsaved** and cannot be ACKed as synchronized. Reopen/merge/sync behavior is tested at source level, not on actual devices.

An existing Moyo board is already based on a Yjs `Y.Doc`, `Y.Map` record IDs, local-author UndoManager and MMKV storage. Its old local board key is unscoped and must be migrated **after ownership is verified**, with a safe old-data read-through. The current native Moyo experiment also mirrors strokes into a second QuickDraw session; this needs a separate single-document consumer migration.

## Native support and version gates

| Runtime | Implementation | Verification |
| --- | --- | --- |
| iPhone/iPad native | React Native Skia v3 Graphite Metal path, source implemented | TS tests pass; Xcode/device NOT RUN |
| Android phone/tablet | React Native Skia v3 Vulkan path independent of Viro | TS tests pass; Android compile in progress |
| Android XR Quest/PICO + Viro | Native Kotlin `CanvasSurfaces` backend with generated Nitro v1 | 47 JVM tests on base PR #18; on-device rendering NOT RUN |
| Web/desktop | Portable source scene and storage contracts | Web renderer integration NOT DONE |
| Muse stylus | Separate `@nitro-forge/spatial-ink` adapter for supported Vision Pro/Viro input | HW pairing/pen device NOT RUN |

**Optional native autolinking:** `react-native.config.cjs` enables the board's Android Viro-specific module only if the host has the native Viro AAR; a normal Skia v3-only phone app must not compile the XR Kotlin `CanvasSurfaces` backend.

Current pins: `react-native-skia@3.8.1` Graphite; Nitro v1 `nitro-core`, `nitrogen`, and `react-native-nitro-modules` **`1.0.0-alpha.nightly.120.g33ef045b96c0`** in the native XR part. Do not co-install old Shopify Skia v2 and Skia v3, nor Nitro v0 and v1. Moyo's current MMKV 4.3.2 was generated with older Nitro v0 declarations; its compatibility with Nitro v1 must be proven in a separate consumer build before rollout.

See [universal/offline acceptance and skill roster](../../docs/native/BOARD_OFFLINE_UNIVERSAL.md), [original Android native extraction](../../docs/native/NATIVE_BOARD_EXTRACTION.md), and [Skia v3 adapter](../../docs/native/BOARD_SKIA3.md).

## Tests and release rules

```sh
pnpm install --no-frozen-lockfile
pnpm --filter @nitro-forge/board codegen
pnpm --filter @nitro-forge/board typecheck
pnpm --filter @nitro-forge/board test
```

A passing Node test suite or a successful npm package install does **not** prove native UI, GPU context lifecycle, physical-device offline survival or realtime collaboration. Moyo and an independent drawing app must each pass a clean install, snapshot/edit/undo/save/terminate/reopen test and documented source parity before release.
