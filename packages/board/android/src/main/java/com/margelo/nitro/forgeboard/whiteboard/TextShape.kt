package com.margelo.nitro.forgeboard.whiteboard

/** A `text` shape. [fixedWidth] is set when QuickDraw's `autosize` is false and `w` is set. */
internal class TextShape(
  override val id: String,
  override val x: Double,
  override val y: Double,
  override val rot: Double,
  override val z: Double,
  val color: InkColor,
  val size: StrokeSize,
  val scale: Double,
  val font: BoardFont,
  val text: String,
  val align: TextAlign,
  val fixedWidth: Double?,
) : BoardShape
