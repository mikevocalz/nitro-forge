package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.forgeboard.BoardCamera
import com.margelo.nitro.forgeboard.WhiteboardRendererState

/**
 * Compile-time fallback for the optional Viro CanvasSurfaces render loop.
 *
 * This class is selected by Gradle ONLY when the host does not ship Viro's
 * Android AAR. No canvas, GPU context, document copy, or render thread is
 * allocated. WhiteboardRendererFactory.isAvailable will be false and reject
 * createRenderer() before constructing an instance.
 *
 * Ordinary 2D Ink uses the separate react-native-skia v3 native Canvas and
 * never needs Viro. Do not use this class as a runtime drawing fallback.
 */
internal class WhiteboardRenderLoop(
  @Suppress("UNUSED_PARAMETER") config: RendererConfig,
  private val onStateChanged: (WhiteboardRendererState) -> Unit,
) {
  @Volatile var state: WhiteboardRendererState = WhiteboardRendererState.INITIALIZING
    private set

  @Volatile var estimatedBytes: Long = 0L
    private set

  fun start(): Nothing = unavailable()
  fun loadSnapshot(@Suppress("UNUSED_PARAMETER") revision: Double,
                   @Suppress("UNUSED_PARAMETER") json: String): Nothing = unavailable()
  fun applyDiff(@Suppress("UNUSED_PARAMETER") revision: Double,
                @Suppress("UNUSED_PARAMETER") json: String): Nothing = unavailable()
  fun setCamera(@Suppress("UNUSED_PARAMETER") camera: BoardCamera): Nothing = unavailable()
  fun setOverlay(@Suppress("UNUSED_PARAMETER") json: String): Nothing = unavailable()

  fun dispose() {
    if (state != WhiteboardRendererState.DISPOSED) {
      state = WhiteboardRendererState.DISPOSED
      onStateChanged(state)
    }
  }

  private fun unavailable(): Nothing =
    throw UnsupportedOperationException(
      "XR CanvasSurfaces requires a compatible Viro Android AAR. " +
      "Use @nitro-forge/board/skia/native for native phone/tablet 2D."
    )
}
