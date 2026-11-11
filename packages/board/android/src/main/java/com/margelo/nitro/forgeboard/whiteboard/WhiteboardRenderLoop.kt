package com.margelo.nitro.forgeboard.whiteboard

import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import com.margelo.nitro.forgeboard.BoardCamera
import com.margelo.nitro.forgeboard.WhiteboardRendererState
import com.viromedia.bridge.canvas.CanvasSurfaces

/**
 * Owns one render thread and everything it touches: the document copy, the
 * camera, the overlay, the caches and the lifecycle.
 *
 * Calls from JS validate and parse on the calling thread, then cross to the
 * render thread once with an immutable result. Frames are drawn only when
 * something changed: at most one frame is queued at a time, so a burst of
 * changes between frames costs one draw. There is no continuous loop.
 */
internal class WhiteboardRenderLoop(
  private val config: RendererConfig,
  private val onStateChanged: (WhiteboardRendererState) -> Unit,
) : CanvasSurfaces.Listener {
  private val slot = SurfaceSlot()
  private val gate = RevisionGate()
  private val disposeLock = Any()
  private var subscription: CanvasSurfaces.Subscription? = null

  // Render thread only.
  private val lifecycle = RendererLifecycle()
  private val document = BoardDocument()
  private val frames = BoardFrameRenderer(config)
  private var camera = BoardCamera(0.0, 0.0, 1.0)
  private var overlay = BoardOverlayState.EMPTY
  private var isFrameQueued = false

  // Started last, so a constructor that throws leaves no thread behind.
  private val thread = HandlerThread("WhiteboardRenderer-${config.surfaceId}").apply { start() }
  private val handler = Handler(thread.looper)

  @Volatile
  var state: WhiteboardRendererState = WhiteboardRendererState.INITIALIZING
    private set

  @Volatile
  var estimatedBytes: Long = 0L
    private set

  @Volatile
  private var isDisposed = false

  /** Subscribes to the Surface. `CanvasSurfaces` delivers an already provided Surface during this call. */
  fun start() {
    // Queued before subscribing so `waiting-for-surface` precedes `active`.
    handler.post { transition(lifecycle.onSubscribed()) }
    subscription = CanvasSurfaces.addListener(config.surfaceId, this)
  }

  fun loadSnapshot(revision: Double, json: String) {
    checkNotDisposed()
    val records = BoardJsonParser.parseSnapshot(json)
    gate.admit(revision) {
      handler.post {
        document.replaceAll(records, revision)
        documentChanged()
      }
    }
  }

  fun applyDiff(revision: Double, json: String) {
    checkNotDisposed()
    val diff = BoardJsonParser.parseDiff(json)
    gate.admit(revision) {
      handler.post {
        document.apply(diff, revision)
        documentChanged()
      }
    }
  }

  fun setCamera(next: BoardCamera) {
    checkNotDisposed()
    next.requireValid()
    handler.post {
      camera = next
      requestFrame()
    }
  }

  fun setOverlay(json: String) {
    checkNotDisposed()
    val next = BoardJsonParser.parseOverlay(json)
    handler.post {
      overlay = next
      requestFrame()
    }
  }

  /** Idempotent. Stops drawing before returning; the render thread finishes queued work and quits. */
  fun dispose() {
    synchronized(disposeLock) {
      if (isDisposed) return
      isDisposed = true
    }
    subscription?.close()
    subscription = null
    slot.clear()
    handler.post {
      frames.release()
      transition(lifecycle.onDisposed())
    }
    thread.quitSafely()
  }

  // CanvasSurfaces.Listener: called on Viro's thread.

  override fun onSurfaceProvided(entry: CanvasSurfaces.Entry) {
    if (isDisposed) return
    slot.provide(entry)
    handler.post {
      transition(lifecycle.onSurfaceProvided())
      requestFrame()
    }
  }

  override fun onSurfaceRevoked(entry: CanvasSurfaces.Entry) {
    // Returns only once no frame is drawing into entry.surface.
    if (!slot.revoke(entry)) return
    handler.post {
      if (!slot.hasSurface) transition(lifecycle.onSurfaceRevoked())
    }
  }

  // Render thread.

  private fun documentChanged() {
    frames.retain(document)
    requestFrame()
  }

  private fun requestFrame() {
    if (isFrameQueued || isDisposed) return
    isFrameQueued = true
    handler.post(::drawFrame)
  }

  private fun drawFrame() {
    isFrameQueued = false
    if (isDisposed) return
    var failure: Throwable? = null
    val drew = slot.withSurface { entry ->
      failure = drawInto(entry)
    }
    estimatedBytes = document.estimatedBytes() + frames.bitmapBytes()
    // Transitions notify JS listeners, so they run only after the slot lock
    // is released: Viro's onSurfaceRevoked waits on that lock.
    val drawFailure = failure
    if (drawFailure != null) {
      Log.w(TAG, "Drawing into surface ${config.surfaceId} failed", drawFailure)
      transition(lifecycle.onDrawFailed())
    } else if (drew && lifecycle.state == WhiteboardRendererState.LOST) {
      transition(lifecycle.onSurfaceProvided())
    }
  }

  /** Caller holds the slot lock, so this must not notify listeners. @return the failure, or null on success. */
  private fun drawInto(entry: CanvasSurfaces.Entry): Throwable? {
    val surface = entry.surface
    if (!surface.isValid) return IllegalStateException("Surface ${entry.id} is no longer valid")
    val canvas = try {
      surface.lockHardwareCanvas()
    } catch (error: IllegalStateException) {
      return error
    } catch (error: IllegalArgumentException) {
      return error
    } catch (error: Surface.OutOfResourcesException) {
      return error
    }
    var failure: Throwable? = null
    var unlockFailure: Throwable? = null
    try {
      frames.draw(canvas, entry.width, entry.height, document, camera, overlay)
    } catch (error: Throwable) {
      // A record the painter cannot draw, or a bitmap that runs out of
      // memory, must not end the HandlerThread and with it the process.
      // The frame is reported as failed (lost); only VM-level errors pass.
      if (!DrawFailures.isRecoverable(error)) throw error
      failure = error
    } finally {
      // Release the locked canvas on every path, including a VM-level error
      // rethrown above. A Surface left locked rejects every later
      // lockHardwareCanvas() call, so the board could never draw again.
      try {
        surface.unlockCanvasAndPost(canvas)
      } catch (error: IllegalStateException) {
        unlockFailure = error
      } catch (error: IllegalArgumentException) {
        unlockFailure = error
      }
    }
    unlockFailure?.let { return it }
    return failure
  }

  private fun transition(next: WhiteboardRendererState?) {
    if (next == null) return
    state = next
    onStateChanged(next)
  }

  private fun checkNotDisposed() {
    check(!isDisposed) { "WhiteboardRenderer for surface ${config.surfaceId} is disposed" }
  }

  private companion object {
    const val TAG = "WhiteboardRenderer"
  }
}
