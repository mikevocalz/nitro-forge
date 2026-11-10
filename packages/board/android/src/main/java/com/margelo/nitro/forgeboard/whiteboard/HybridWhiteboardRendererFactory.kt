package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.core.Promise
import com.margelo.nitro.forgeboard.HybridWhiteboardRendererFactorySpec
import com.margelo.nitro.forgeboard.HybridWhiteboardRendererSpec
import com.margelo.nitro.forgeboard.WhiteboardRendererOptions

/**
 * Android `WhiteboardRendererFactory`. Every member is static; JS never
 * constructs an instance.
 */
class HybridWhiteboardRendererFactory : HybridWhiteboardRendererFactorySpec() {
  companion object : HybridWhiteboardRendererFactorySpec.Companion {
    override val isAvailable: Boolean
      get() = WhiteboardRendererAvailability.isAvailable

    override fun createRenderer(options: WhiteboardRendererOptions): Promise<HybridWhiteboardRendererSpec> {
      if (!WhiteboardRendererAvailability.isAvailable) {
        return Promise.rejected(UnsupportedOperationException(WhiteboardRendererAvailability.unavailableReason()))
      }
      val renderer = try {
        HybridWhiteboardRenderer(options.toRendererConfig())
      } catch (error: IllegalArgumentException) {
        return Promise.rejected(error)
      }
      try {
        renderer.start()
      } catch (error: Throwable) {
        // The renderer already runs its HandlerThread; stop it before rejecting.
        try {
          renderer.dispose()
        } catch (disposeError: Throwable) {
          error.addSuppressed(disposeError)
        }
        return Promise.rejected(error)
      }
      return Promise.resolved(renderer)
    }
  }
}
