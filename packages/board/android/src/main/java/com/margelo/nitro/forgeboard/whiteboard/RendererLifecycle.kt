package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.forgeboard.WhiteboardRendererState

/**
 * The renderer's state machine:
 *
 * ```
 * initializing -> waiting-for-surface -> active <-> suspended
 *                                          |  ^
 *                                          v  |  (a new Surface)
 *                                          lost
 * any state -> disposed (terminal)
 * ```
 *
 * Each event returns the new state, or null when the state does not change.
 * Owned by the render thread.
 */
internal class RendererLifecycle {
  var state: WhiteboardRendererState = WhiteboardRendererState.INITIALIZING
    private set

  /** The Surface subscription is in place. */
  fun onSubscribed(): WhiteboardRendererState? =
    if (state == WhiteboardRendererState.INITIALIZING) move(WhiteboardRendererState.WAITING_FOR_SURFACE) else null

  /** Viro provided a Surface (first time, again after a revoke, or after a loss). */
  fun onSurfaceProvided(): WhiteboardRendererState? =
    when (state) {
      WhiteboardRendererState.DISPOSED, WhiteboardRendererState.ACTIVE -> null
      else -> move(WhiteboardRendererState.ACTIVE)
    }

  /** Viro withdrew the Surface. */
  fun onSurfaceRevoked(): WhiteboardRendererState? =
    when (state) {
      WhiteboardRendererState.ACTIVE, WhiteboardRendererState.LOST -> move(WhiteboardRendererState.SUSPENDED)
      else -> null
    }

  /** Locking, drawing into or posting the Surface failed. */
  fun onDrawFailed(): WhiteboardRendererState? =
    if (state == WhiteboardRendererState.ACTIVE) move(WhiteboardRendererState.LOST) else null

  fun onDisposed(): WhiteboardRendererState? =
    if (state == WhiteboardRendererState.DISPOSED) null else move(WhiteboardRendererState.DISPOSED)

  private fun move(next: WhiteboardRendererState): WhiteboardRendererState {
    state = next
    return next
  }
}
