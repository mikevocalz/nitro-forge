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
