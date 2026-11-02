package com.margelo.nitro.forgeboard.whiteboard

/** A `geo` shape in a `w` x `h` local box, with an optional centred label. */
internal class GeoShape(
  override val id: String,
  override val x: Double,
  override val y: Double,
  override val rot: Double,
  override val z: Double,
  val color: InkColor,
  val size: StrokeSize,
  val dash: DashStyle,
  val fill: FillStyle,
  val geo: GeoKind,
  val w: Double,
  val h: Double,
  val label: String,
  val labelSize: StrokeSize,
  val font: BoardFont,
) : BoardShape
