package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.core.Callback
import com.margelo.nitro.core.callAndForget
import com.margelo.nitro.forgeboard.BoardCamera
import com.margelo.nitro.forgeboard.HybridWhiteboardRendererSpec
import com.margelo.nitro.forgeboard.ListenerSubscription
import com.margelo.nitro.forgeboard.WhiteboardRendererState
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Android `WhiteboardRenderer`. A thin JS-facing shell over
 * [WhiteboardRenderLoop], which owns the render thread and the document.
 * Created only by [HybridWhiteboardRendererFactory].
 */
class HybridWhiteboardRenderer internal constructor(config: RendererConfig) : HybridWhiteboardRendererSpec() {
  companion object : HybridWhiteboardRendererSpec.Companion

  // Copy-on-write: registration happens on JS threads, delivery on the render
  // thread iterates a snapshot without locking.
  private val listeners = CopyOnWriteArrayList<Callback<(state: WhiteboardRendererState) -> Unit>>()
  private val loop = WhiteboardRenderLoop(config) { state -> notify(state) }

  override val state: WhiteboardRendererState
    get() = loop.state

  override val memorySize: Long
    get() = loop.estimatedBytes

  internal fun start() {
    loop.start()
  }

  override fun loadSnapshot(revision: Double, snapshotJson: String) {
    loop.loadSnapshot(revision, snapshotJson)
  }

  override fun applyDiff(revision: Double, diffJson: String) {
    loop.applyDiff(revision, diffJson)
  }

  override fun setCamera(camera: BoardCamera) {
    loop.setCamera(camera)
  }

  override fun setOverlay(overlayJson: String) {
    loop.setOverlay(overlayJson)
  }

  override fun addOnStateChangedListener(
    listener: Callback<(state: WhiteboardRendererState) -> Unit>,
  ): ListenerSubscription {
    listeners.add(listener)
    return ListenerSubscription(Callback.native<() -> Unit> { listeners.remove(listener) })
  }

  override fun dispose() {
    loop.dispose()
    super.dispose()
  }

  private fun notify(state: WhiteboardRendererState) {
    for (listener in listeners) listener.callAndForget(state)
    if (state == WhiteboardRendererState.DISPOSED) listeners.clear()
  }
}
