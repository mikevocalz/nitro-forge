package com.margelo.nitro.forgeboard.whiteboard

/**
 * A QuickDraw `shape` record. Every variant keeps QuickDraw's transform:
 * translate to ([x], [y]), then rotate by [rot] radians about the centre of
 * its local bounds.
 */
internal sealed interface BoardShape : BoardRecord {
  val x: Double
  val y: Double
  val rot: Double
  val z: Double
}
