package com.margelo.nitro.forgeboard.whiteboard

/** A `highlight` shape: a wide translucent band multiplied into the paper. */
internal class HighlightShape(
  override val id: String,
  override val x: Double,
  override val y: Double,
  override val rot: Double,
  override val z: Double,
  val color: InkColor,
  val size: StrokeSize,
  /** Flat `[x, y, pressure, ...]` triplets in local coordinates. */
  val points: DoubleArray,
) : BoardShape
