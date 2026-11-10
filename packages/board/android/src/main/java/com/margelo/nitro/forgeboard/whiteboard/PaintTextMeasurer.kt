package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Paint

/** [TextMeasurer] backed by a `Paint`. Render thread only. */
internal class PaintTextMeasurer : TextMeasurer {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val metrics = Paint.FontMetrics()
  private val baselines = HashMap<String, Double>()

  override fun width(text: String, fontSize: Double, font: BoardFont): Double {
    configure(fontSize, font)
    return paint.measureText(text).toDouble()
  }

  override fun baseline(font: BoardFont, fontSize: Double, lineHeight: Double): Double {
    val key = "$fontSize|$lineHeight|${font.id}"
    baselines[key]?.let { return it }
    configure(fontSize, font)
    paint.getFontMetrics(metrics)
    // FontMetrics.ascent is negative (above the baseline).
    val ascent = -metrics.ascent.toDouble()
    val descent = metrics.descent.toDouble()
    val baseline = (lineHeight - (ascent + descent)) / 2 + ascent
    baselines[key] = baseline
    return baseline
  }

  private fun configure(fontSize: Double, font: BoardFont) {
    paint.typeface = BoardTypefaces.typeface(font)
    paint.textSize = fontSize.toFloat()
  }
}
