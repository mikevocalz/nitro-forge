package com.margelo.nitro.forgeboard.whiteboard

/**
 * A `draw` (pencil) shape. With [dash] `draw` it is filled pressure ink whose
 * outline QuickDraw computed in JS ([inkOutline], flat local `[x, y, ...]`);
 * any other dash strokes the smoothed centerline at an even width.
 */
internal class DrawShape(
  override val id: String,
  override val x: Double,
  override val y: Double,
  override val rot: Double,
  override val z: Double,
  val color: InkColor,
  val size: StrokeSize,
  val dash: DashStyle,
  /** Flat `[x, y, pressure, ...]` triplets in local coordinates. */
  val points: DoubleArray,
  /** Present exactly when [dash] is [DashStyle.DRAW]. */
  val inkOutline: DoubleArray?,
  /** QuickDraw's `done`: false while the stroke is still growing. */
  val isDone: Boolean,
) : BoardShape
