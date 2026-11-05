package com.margelo.nitro.forgeboard.whiteboard

/** Validated [com.margelo.nitro.forgeboard.WhiteboardRendererOptions]. */
internal data class RendererConfig(
  val surfaceId: Int,
  val widthPx: Int,
  val heightPx: Int,
  val pixelRatio: Double,
  val cornerRadiusPx: Double,
  val backgroundArgb: Int,
) {
  /** The board's view size in board units. */
  val viewWidth: Double
    get() = widthPx / pixelRatio

  val viewHeight: Double
    get() = heightPx / pixelRatio
}
