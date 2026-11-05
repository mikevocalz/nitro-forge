package com.margelo.nitro.forgeboard.whiteboard

import com.viromedia.bridge.canvas.CanvasSurfaces

/**
 * The Surface currently provided to the renderer.
 *
 * `CanvasSurfaces` may release a Surface as soon as `onSurfaceRevoked`
 * returns, and that callback runs on Viro's thread while the render thread
 * may be mid-frame. Drawing and revoking therefore share this lock: [revoke]
 * waits for an in-flight frame, and no frame starts on a revoked Surface.
 * The lock is never held while calling listeners or JS.
 */
internal class SurfaceSlot {
  private val lock = Any()
  private var current: CanvasSurfaces.Entry? = null

  fun provide(entry: CanvasSurfaces.Entry) {
    synchronized(lock) { current = entry }
  }

  /** Withdraws [entry] if it is still current. @return true if it was. */
  fun revoke(entry: CanvasSurfaces.Entry): Boolean =
    synchronized(lock) {
      if (current !== entry) return false
      current = null
      true
    }

  fun clear() {
    synchronized(lock) { current = null }
  }

  val hasSurface: Boolean
    get() = synchronized(lock) { current != null }

  /** Runs [draw] with the current entry under the lock. @return false when there is no Surface. */
  fun withSurface(draw: (CanvasSurfaces.Entry) -> Unit): Boolean =
    synchronized(lock) {
      val entry = current ?: return false
      draw(entry)
      true
    }
}
