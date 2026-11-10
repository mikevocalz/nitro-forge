package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.forgeboard.WhiteboardRendererOptions

/**
 * Validates the JS options.
 * @throws IllegalArgumentException naming the first invalid field.
 */
internal fun WhiteboardRendererOptions.toRendererConfig(): RendererConfig {
  fun integer(name: String, value: Double, min: Int): Int {
    require(value.isFinite() && value == Math.rint(value) && value >= min && value <= Int.MAX_VALUE) {
      "$name must be an integer >= $min, got $value"
    }
    return value.toInt()
  }
  require(pixelRatio.isFinite() && pixelRatio > 0) { "pixelRatio must be finite and > 0, got $pixelRatio" }
  require(cornerRadiusPx.isFinite() && cornerRadiusPx >= 0) { "cornerRadiusPx must be finite and >= 0, got $cornerRadiusPx" }
  return RendererConfig(
    surfaceId = integer("surfaceId", surfaceId, Int.MIN_VALUE),
    widthPx = integer("widthPx", widthPx, 1),
    heightPx = integer("heightPx", heightPx, 1),
    pixelRatio = pixelRatio,
    cornerRadiusPx = cornerRadiusPx,
    backgroundArgb = HexColor.parse(backgroundColor),
  )
}
