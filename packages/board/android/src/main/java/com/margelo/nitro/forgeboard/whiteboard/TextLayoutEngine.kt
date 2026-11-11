package com.margelo.nitro.forgeboard.whiteboard

import java.util.WeakHashMap
import java.util.regex.Pattern
import kotlin.math.max

/**
 * `textLayout`, `noteLayout`, `geoLabelLayout` and `wrapLines` from
 * `shapes.js` (QuickDraw 0.2.0). Layouts are cached per shape instance;
 * records are immutable, so an edited shape is a new instance and misses.
 * Used only on the render thread.
 */
internal class TextLayoutEngine(private val measurer: TextMeasurer) {
  private val cache = WeakHashMap<BoardShape, TextBlockLayout>()

  fun textLayout(shape: TextShape): TextBlockLayout {
    cache[shape]?.let { return it }
    val fontSize = shape.size.fontSize * shape.scale
    val lineHeight = fontSize * 1.32
    val maxWidth = shape.fixedWidth ?: 0.0
    val lines = wrapLines(shape.text, shape.font, fontSize, maxWidth)
    val width = if (maxWidth > 0) maxWidth else max(8.0, lines.maxOfOrNull { it.width } ?: 0.0) + 2
    val layout = TextBlockLayout(
      lines = lines,
      font = shape.font,
      fontSize = fontSize,
      lineHeight = lineHeight,
      width = width,
      height = max(lineHeight, lines.size * lineHeight),
      textHeight = lines.size * lineHeight,
      boxHeight = 0.0,
    )
    cache[shape] = layout
    return layout
  }

  fun noteLayout(shape: NoteShape): TextBlockLayout {
    cache[shape]?.let { return it }
    val fontSize = shape.size.noteFontSize
    val lineHeight = fontSize * 1.35
    val lines = wrapLines(shape.text, shape.font, fontSize, BoardPalette.NOTE_W - BoardPalette.NOTE_PAD * 2)
    val textHeight = lines.size * lineHeight
    val layout = TextBlockLayout(
      lines = lines,
      font = shape.font,
      fontSize = fontSize,
      lineHeight = lineHeight,
      width = 0.0,
      height = 0.0,
      textHeight = textHeight,
      boxHeight = max(BoardPalette.NOTE_W, textHeight + BoardPalette.NOTE_PAD * 2),
    )
    cache[shape] = layout
    return layout
  }

  /** @return null when the shape has no label. */
  fun labelLayout(shape: GeoShape): TextBlockLayout? {
    if (shape.label.isEmpty()) return null
    cache[shape]?.let { return it }
    val fontSize = shape.labelSize.fontSize
    val lineHeight = fontSize * 1.3
    val lines = wrapLines(shape.label, shape.font, fontSize, max(24.0, shape.w - BoardPalette.LABEL_PAD * 2))
    val layout = TextBlockLayout(
      lines = lines,
      font = shape.font,
      fontSize = fontSize,
      lineHeight = lineHeight,
      width = 0.0,
      height = 0.0,
      textHeight = lines.size * lineHeight,
      boxHeight = 0.0,
    )
    cache[shape] = layout
    return layout
  }

  fun baseline(layout: TextBlockLayout): Double = measurer.baseline(layout.font, layout.fontSize, layout.lineHeight)

  fun clear() {
    cache.clear()
  }

  /** `wrapLines`: greedy word wrap at [maxWidth]; 0 means no wrapping. */
  fun wrapLines(text: String, font: BoardFont, fontSize: Double, maxWidth: Double): List<TextLine> {
    val out = ArrayList<TextLine>()
    for (paragraph in text.split("\n")) {
      if (paragraph.isEmpty()) {
        out.add(TextLine("", 0.0))
        continue
      }
      var line = ""
      for (word in splitKeepingWhitespace(paragraph)) {
        val test = line + word
        if (line.isNotEmpty() && maxWidth > 0 && measurer.width(test, fontSize, font) > maxWidth) {
          out.add(TextLine(line, measurer.width(line, fontSize, font)))
          line = word.trimStart()
        } else {
          line = test
        }
      }
      out.add(TextLine(line, measurer.width(line, fontSize, font)))
    }
    return out
  }

  /** JS `para.split(/(\s+)/)`: words and the whitespace runs between them, in order. */
  private fun splitKeepingWhitespace(paragraph: String): List<String> {
    val tokens = ArrayList<String>()
    val matcher = WHITESPACE.matcher(paragraph)
    var start = 0
    while (matcher.find()) {
      tokens.add(paragraph.substring(start, matcher.start()))
      tokens.add(matcher.group())
      start = matcher.end()
    }
    tokens.add(paragraph.substring(start))
    return tokens
  }

  private companion object {
    val WHITESPACE: Pattern = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS)
  }
}
