package com.margelo.nitro.forgeboard.whiteboard

import android.os.Build

/**
 * Whether the native board renderer can run here. Viro is a compile-only
 * dependency, so an app on an older Viro build may lack `CanvasSurfaces`.
 */
internal object WhiteboardRendererAvailability {
  private const val CANVAS_SURFACES = "com.viromedia.bridge.canvas.CanvasSurfaces"

  /** API 29 brings `BlendMode.MULTIPLY`, which the highlighter needs. */
  val isAvailable: Boolean by lazy {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasCanvasSurfaces()
  }

  /** The reason [isAvailable] is false, for error messages. */
  fun unavailableReason(): String =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      "the native whiteboard renderer needs Android 10 (API 29) or later; this device runs API ${Build.VERSION.SDK_INT}"
    } else {
      "this app's Viro build has no $CANVAS_SURFACES; update @reactvision/react-viro to a build with the public Surface registry"
    }

  private fun hasCanvasSurfaces(): Boolean {
    try {
      Class.forName(CANVAS_SURFACES)
      return true
    } catch (_: ClassNotFoundException) {
      return false
    }
  }
}
