package com.margelo.nitro.forgeboard.whiteboard

/**
 * Receives path commands. Geometry is built against this interface so it can
 * be tested on the JVM; the renderer feeds an `android.graphics.Path`.
 */
internal interface PathSink {
  fun moveTo(x: Double, y: Double)

  fun lineTo(x: Double, y: Double)

  fun quadTo(cx: Double, cy: Double, x: Double, y: Double)

  fun close()

  /** Adds a closed ellipse inscribed in the given box. */
  fun addOval(left: Double, top: Double, right: Double, bottom: Double)
}
