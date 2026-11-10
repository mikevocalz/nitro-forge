package com.margelo.nitro.forgeboard.whiteboard

/**
 * An `arrow` or `line` shape from the local origin to ([dx], [dy]). A non-zero
 * [bend] curves it so the curve passes [bend] units off the chord's midpoint.
 */
internal class ConnectorShape(
  override val id: String,
  override val x: Double,
  override val y: Double,
  override val rot: Double,
  override val z: Double,
  val color: InkColor,
  val size: StrokeSize,
  val dash: DashStyle,
  val dx: Double,
  val dy: Double,
  val bend: Double,
  /** True for `arrow`, false for `line`. */
  val hasArrowHead: Boolean,
) : BoardShape
