package com.margelo.nitro.forgeboard.whiteboard

/** A `note` (sticky) shape: a fixed-width paper with centred text. */
internal class NoteShape(
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
) : BoardShape
