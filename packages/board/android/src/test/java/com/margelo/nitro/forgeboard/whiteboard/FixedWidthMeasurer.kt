package com.margelo.nitro.forgeboard.whiteboard

/** Every character is half the font size wide; the baseline sits at 80% of the line box. */
internal class FixedWidthMeasurer : TextMeasurer {
  override fun width(text: String, fontSize: Double, font: BoardFont): Double = text.length * fontSize * 0.5

  override fun baseline(font: BoardFont, fontSize: Double, lineHeight: Double): Double = lineHeight * 0.8
}
