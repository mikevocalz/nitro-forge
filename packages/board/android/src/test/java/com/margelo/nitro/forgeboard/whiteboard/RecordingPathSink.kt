package com.margelo.nitro.forgeboard.whiteboard

/** Records path commands as strings, for asserting geometry without Android. */
internal class RecordingPathSink : PathSink {
  val commands = ArrayList<String>()

  override fun moveTo(x: Double, y: Double) {
    commands.add("M $x $y")
  }

  override fun lineTo(x: Double, y: Double) {
    commands.add("L $x $y")
  }

  override fun quadTo(cx: Double, cy: Double, x: Double, y: Double) {
    commands.add("Q $cx $cy $x $y")
  }

  override fun close() {
    commands.add("Z")
  }

  override fun addOval(left: Double, top: Double, right: Double, bottom: Double) {
    commands.add("O $left $top $right $bottom")
  }
}
