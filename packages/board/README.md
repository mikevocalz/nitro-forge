# @nitro-forge/board

Standalone Nitro-Forge native whiteboard and canvas renderer extracted from
`@viro-external/native-panels`. It is **not** a Moyo Learn component.

- QuickDraw-compatible snapshots, diffs, vector/pressure ink outlines, shapes,
  images, overlays, and camera.
- Native Android 10+ `Canvas.lockHardwareCanvas()` renderer on Viro-owned
  XR `CanvasSurfaces`; no WebView for native rendering.
- One QuickDraw document/store authority. Native renderer holds a *derived*
  drawing copy; only the document owner handles undo, persistence and remote diffs.
- `@nitro-forge/spatial-ink` delivers normalized Logitech Muse events through
  the existing QuickDraw input router. This package does not pair Muse directly.
- Separate `@nitro-forge/prism` continues to own raster/image document ops.
- Version is private/draft until Nitro v1 codegen, app compilation, device
  testing and source migration are demonstrated.

See [the extraction and validation guide](../../docs/native/NATIVE_BOARD_EXTRACTION.md).

## Platform capabilities

| Runtime | Capability |
| --- | --- |
| Quest/PICO Android 10+ with compatible Viro CanvasSurfaces registry | Android native renderer source (device tests NOT RUN) |
| Android without Viro CanvasSurfaces | Unavailable; consumer fallback required |
| iOS / visionOS | Apple native renderer NOT IMPLEMENTED |
| web | Renderer NOT IMPLEMENTED, share document contract only |

No claim is made that merely importing the package provides native iOS
rendering or a fully migrated Moyo whiteboard.

## Local Yjs persistence

The offline exports are portable and independent of the renderer. Keep the
host's existing Yjs document as the authority and provide its storage instance:

```ts
import { createMMKV } from "react-native-mmkv";
import * as Y from "yjs";
import { createMMKVBoardStorage } from "@nitro-forge/board/offline/mmkv";
import { createLocalYjsBoardSession } from "@nitro-forge/board/offline/yjs";

const storage = createMMKVBoardStorage(createMMKV({ id: "boards" }), {
  scope: "organization-id/account-id",
});

// `doc` is the host-owned Y.Doc already used by the board and undo manager.
const session = createLocalYjsBoardSession({
  documentId: "board-id",
  storage,
  document: {
    encode: () => Y.encodeStateAsUpdate(doc),
    merge: (bytes, origin) => Y.applyUpdate(doc, bytes, origin),
  },
});
await session.initialize(); // Before mounting the editable view.
// After a completed local transaction:
const receipt = await session.saveLocal();
// On leaving the board, await queued writes before destroying the host's doc:
await session.close();
```

Only a successful receipt means the write completed. Storage failures preserve
the edited live document and remain visible to the caller. Optional
`subscribeChanges` needs an `onPersistenceError` handler. Corruption is reported
without overwriting the record; explicit recovery requires the exact board ID.
A partially throwing Yjs restore/remote merge disables the session and requires
a fresh host-owned document, since Yjs updates cannot undo a partial merge.

`@nitro-forge/board/offline/sync` supplies a coordinator for the host's
authenticated transport. An ACK applies only to the revision actually sent;
later edits stay pending. The SDK does not open sockets or manage credentials.

New MMKV records checksum their metadata and payload together. Legacy records
remain readable and are upgraded on a successful save. The native acceptance
app uses a pinned MMKV v4 binding port for Nitro v1; see
[the compatibility, provenance and execution guide](../../docs/native/MMKV_V1_PORT.md)
before using the same native dependency graph.
