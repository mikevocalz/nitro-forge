package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertEquals
import org.junit.Test

class TextLayoutEngineTest {
  private val engine = TextLayoutEngine(FixedWidthMeasurer())

  @Test
  fun wrapsGreedilyAndTrimsTheCarriedWord() {
    // 10 px per character at font size 20; 100 px fits ten characters.
    val lines = engine.wrapLines("alpha beta gamma", BoardFont.DRAW, 20.0, 100.0)
    assertEquals(listOf("alpha beta", "gamma"), lines.map { it.text })
    assertEquals(100.0, lines[0].width, 0.0)
  }

  @Test
  fun keepsEmptyParagraphsAndNeverWrapsWithoutAWidth() {
    val lines = engine.wrapLines("one two three\n\nfour", BoardFont.SANS, 20.0, 0.0)
    assertEquals(listOf("one two three", "", "four"), lines.map { it.text })
  }

  @Test
  fun autosizedTextIsAsWideAsItsLongestLinePlusTwo() {
    val shape = TextShape("shape:t", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, StrokeSize.S, 1.0, BoardFont.DRAW, "hi\nthere", TextAlign.START, null)
    val layout = engine.textLayout(shape)
    // FONT_SIZES.s = 20 -> 10 px per char; "there" = 50; + 2
    assertEquals(52.0, layout.width, 1e-9)
    assertEquals(2 * 20 * 1.32, layout.height, 1e-9)
  }

  @Test
  fun noteIsAtLeastSquare() {
    val shape = NoteShape("shape:n", 0.0, 0.0, 0.0, 1.0, InkColor.YELLOW, StrokeSize.M, 1.0, BoardFont.DRAW, "short")
    assertEquals(200.0, engine.noteLayout(shape).boxHeight, 0.0)
  }

  @Test
  fun geoWithoutLabelHasNoLabelLayout() {
    val shape = GeoShape("shape:g", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, StrokeSize.M, DashStyle.SOLID, FillStyle.NONE, GeoKind.RECTANGLE, 40.0, 20.0, "", StrokeSize.S, BoardFont.DRAW)
    assertEquals(null, engine.labelLayout(shape))
  }
}
