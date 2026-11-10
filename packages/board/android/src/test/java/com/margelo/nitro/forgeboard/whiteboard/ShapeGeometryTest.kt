package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class ShapeGeometryTest {
  private fun connector(dx: Double, dy: Double, bend: Double, size: StrokeSize = StrokeSize.M) =
    ConnectorShape("shape:c", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, size, DashStyle.SOLID, dx, dy, bend, hasArrowHead = true)

  private fun geo(kind: GeoKind, dash: DashStyle) =
    GeoShape("shape:g", 0.0, 0.0, 0.0, 1.0, InkColor.BLACK, StrokeSize.M, dash, FillStyle.NONE, kind, 40.0, 20.0, "", StrokeSize.S, BoardFont.DRAW)

  @Test
  fun straightArrowHeadFollowsTheChord() {
    val head = ShapeGeometry.arrowHead(connector(100.0, 0.0, 0.0))
    // shapes.js: hl = min(max(w * 3.2, 12), len * 0.4) = 12.8 for size m
    val hl = 12.8
    val expected = doubleArrayOf(100 - cos(-0.5) * hl, -sin(-0.5) * hl, 100.0, 0.0, 100 - cos(0.5) * hl, -sin(0.5) * hl)
    assertArrayEquals(expected, head, 1e-12)
  }

  @Test
  fun bentConnectorCurvesThroughTwiceTheBend() {
    val c = ShapeGeometry.controlPoint(connector(100.0, 0.0, 10.0))
    assertEquals(BoardPoint(50.0, 20.0), c)
    val sink = RecordingPathSink()
    ShapeGeometry.connectorBody(sink, connector(100.0, 0.0, 10.0))
    assertEquals(listOf("M 0.0 0.0", "Q 50.0 20.0 100.0 0.0"), sink.commands)
  }

  @Test
  fun shortArrowHeadIsCappedAtFortyPercentOfTheLength() {
    val head = ShapeGeometry.arrowHead(connector(10.0, 0.0, 0.0))
    assertEquals(4.0, kotlin.math.hypot(head[0] - 10.0, head[1]), 1e-12)
  }

  @Test
  fun solidEllipseIsAnOval() {
    val sink = RecordingPathSink()
    ShapeGeometry.geoOutline(sink, geo(GeoKind.ELLIPSE, DashStyle.SOLID))
    assertEquals(listOf("O 0.0 0.0 40.0 20.0"), sink.commands)
  }

  @Test
  fun solidTriangleIsAClosedPolygon() {
    val sink = RecordingPathSink()
    ShapeGeometry.geoOutline(sink, geo(GeoKind.TRIANGLE, DashStyle.SOLID))
    assertEquals(listOf("M 20.0 0.0", "L 40.0 20.0", "L 0.0 20.0", "Z"), sink.commands)
  }

  @Test
  fun drawDashGeoIsWobbledAndClosed() {
    val sink = RecordingPathSink()
    ShapeGeometry.geoOutline(sink, geo(GeoKind.RECTANGLE, DashStyle.DRAW))
    assertEquals("Z", sink.commands.last())
    assert(sink.commands.size > 5) { "a wobbled rectangle has more than four corners" }
  }

  @Test
  fun inkOutlineIsTracedClosed() {
    val sink = RecordingPathSink()
    ShapeGeometry.inkOutline(sink, doubleArrayOf(0.0, 0.0, 4.0, 0.0, 4.0, 4.0))
    assertEquals("M 0.0 0.0", sink.commands.first())
    assertEquals("Z", sink.commands.last())
  }
}
