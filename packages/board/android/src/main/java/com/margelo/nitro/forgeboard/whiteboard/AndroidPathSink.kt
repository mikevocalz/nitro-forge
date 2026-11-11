package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Path

/** Writes [PathSink] commands into an `android.graphics.Path`. */
internal class AndroidPathSink(val path: Path) : PathSink {
  override fun moveTo(x: Double, y: Double) {
    path.moveTo(x.toFloat(), y.toFloat())
  }

  override fun lineTo(x: Double, y: Double) {
    path.lineTo(x.toFloat(), y.toFloat())
  }

  override fun quadTo(cx: Double, cy: Double, x: Double, y: Double) {
    path.quadTo(cx.toFloat(), cy.toFloat(), x.toFloat(), y.toFloat())
  }

  override fun close() {
    path.close()
  }

  override fun addOval(left: Double, top: Double, right: Double, bottom: Double) {
    path.addOval(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat(), Path.Direction.CW)
  }
}
