package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.PI

class ShapeBoundsTest {
  private val bounds = ShapeBounds(TextLayoutEngine(FixedWidthMeasurer()))

  @Test
  fun drawBoundsGrowByThreeQuartersOfTheStrokeWidth() {
    val shape = DrawShape(
      "shape:d", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, StrokeSize.M, DashStyle.DRAW,
      doubleArrayOf(0.0, 0.0, 0.5, 10.0, 20.0, 0.5), doubleArrayOf(), isDone = true,
    )
    assertEquals(BoardRect(-3.0, -3.0, 16.0, 26.0), bounds.localBounds(shape))
  }

  @Test
  fun highlightBoundsGrowByHalfTheBand() {
    val shape = HighlightShape("shape:h", 0.0, 0.0, 0.0, 1.0, InkColor.YELLOW, StrokeSize.M, doubleArrayOf(0.0, 0.0, 0.5, 10.0, 0.0, 0.5))
    // SIZES.m 4 * HIGHLIGHT_SCALE 4.5 / 2 = 9
    assertEquals(BoardRect(-9.0, -9.0, 28.0, 18.0), bounds.localBounds(shape))
  }

  @Test
  fun bentConnectorBoundsIncludeTheBend() {
    val shape = ConnectorShape("shape:c", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, StrokeSize.M, DashStyle.SOLID, -30.0, 40.0, 5.0, false)
    assertEquals(BoardRect(-35.0, -5.0, 40.0, 50.0), bounds.localBounds(shape))
  }

  @Test
  fun quarterTurnSwapsPageBoundsAboutTheCentre() {
    val shape = GeoShape("shape:g", 100.0, 100.0, PI / 2, 1.0, InkColor.BLACK, StrokeSize.M, DashStyle.SOLID, FillStyle.NONE, GeoKind.RECTANGLE, 40.0, 20.0, "", StrokeSize.S, BoardFont.DRAW)
    val pb = bounds.pageBounds(shape)
    assertEquals(110.0, pb.x, 1e-9)
    assertEquals(90.0, pb.y, 1e-9)
    assertEquals(20.0, pb.w, 1e-9)
    assertEquals(40.0, pb.h, 1e-9)
  }

  @Test
  fun zeroSizedGeoCountsAsOneUnit() {
    val shape = GeoShape("shape:g", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, StrokeSize.M, DashStyle.SOLID, FillStyle.NONE, GeoKind.RECTANGLE, 0.0, 0.0, "", StrokeSize.S, BoardFont.DRAW)
    assertEquals(BoardRect(0.0, 0.0, 1.0, 1.0), bounds.localBounds(shape))
  }
}
