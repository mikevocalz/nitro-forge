package com.margelo.nitro.forgeboard.whiteboard

/** Font metrics in page units, standing in for QuickDraw's Canvas2D `measureText`. */
internal interface TextMeasurer {
  /** Advance width of [text] at weight 500. */
  fun width(text: String, fontSize: Double, font: BoardFont): Double

  /**
   * `lineBaseline` in `shapes.js`: the alphabetic baseline inside a line box
   * of [lineHeight], `(lineHeight - (ascent + descent)) / 2 + ascent`.
   */
  fun baseline(font: BoardFont, fontSize: Double, lineHeight: Double): Double
}
