package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.min

class BoardGeometryTest {
  @Test
  fun wobbledRectangleMatchesQuickDraw() {
    // node: wobblePolyline(geoPolygon('rectangle', 120, 80), 'shape:geo1', { step: 22, amp })
    val pts = BoardGeometry.wobblePolyline(
      BoardGeometry.geoPolygon(GeoKind.RECTANGLE, 120.0, 80.0), "shape:geo1", 22.0, min(2.2, 200.0 / 160 + 0.6),
    )
    assertEquals(36, pts.size)
    val expected = doubleArrayOf(0.0, 0.55485383719391690, 24.0, 1.7148653364643347, 48.0, 1.2993241278330316, 72.0, 0.67095452693507684)
    assertArrayEquals(expected, pts.copyOfRange(0, 8), 1e-9)
  }

  @Test
  fun wobbledEllipseMatchesQuickDraw() {
    val pts = BoardGeometry.wobblePolyline(BoardGeometry.ellipsePolygon(90.0, 60.0, 40), "shape:ell", 18.0, min(2.0, 90.0 / 40 + 0.6))
    assertEquals(80, pts.size)
    assertArrayEquals(doubleArrayOf(89.078809029935613, 25.350310970168398), pts.copyOfRange(78, 80), 1e-9)
  }

  @Test
  fun starStartsAtTheTopPoint() {
    val star = BoardGeometry.geoPolygon(GeoKind.STAR, 100.0, 50.0)
    assertEquals(20, star.size)
    assertArrayEquals(doubleArrayOf(50.0, 0.0, 63.225168176580645, 15.898558813281841), star.copyOfRange(0, 4), 1e-9)
  }

  @Test
  fun traceSmoothUsesMidpointQuadratics() {
    val sink = RecordingPathSink()
    BoardGeometry.traceSmooth(sink, doubleArrayOf(0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0), closed = true)
    assertEquals(listOf("M 0.0 0.0", "Q 10.0 0.0 10.0 5.0", "Q 10.0 10.0 5.0 10.0", "L 0.0 10.0", "Z"), sink.commands)
  }

  @Test
  fun traceSmoothDrawsStraightSegmentsBelowThreePoints() {
    val sink = RecordingPathSink()
    BoardGeometry.traceSmooth(sink, doubleArrayOf(1.0, 2.0, 3.0, 4.0), closed = false)
    assertEquals(listOf("M 1.0 2.0", "L 3.0 4.0"), sink.commands)
  }

  @Test
  fun tripletBoundsSkipsPressure() {
    assertEquals(BoardRect(-2.0, 1.0, 12.0, 6.0), BoardGeometry.tripletBounds(doubleArrayOf(-2.0, 1.0, 0.9, 10.0, 7.0, 0.1)))
  }
}
