package com.margelo.nitro.forgeboard.whiteboard

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The local-space paths `drawShape` in `shapes.js` (QuickDraw 0.2.0) traces
 * for each shape type, written to a [PathSink].
 */
internal object ShapeGeometry {
  /** The filled pressure-ink outline: `drawPath` traces it smooth and closed. */
  fun inkOutline(sink: PathSink, outline: DoubleArray) {
    BoardGeometry.traceSmooth(sink, outline, closed = true)
    sink.close()
  }

  /** The smoothed open centerline QuickDraw strokes for highlights and non-ink draw dashes. */
  fun centerline(sink: PathSink, points: DoubleArray) {
    BoardGeometry.traceSmooth(sink, BoardGeometry.xyOfTriplets(points), closed = false)
  }

  /** `geoPath`: the geo outline, wobbled for dash `draw`. */
  fun geoOutline(sink: PathSink, shape: GeoShape) {
    val w = shape.w
    val h = shape.h
    if (shape.geo == GeoKind.ELLIPSE) {
      if (shape.dash == DashStyle.DRAW) {
        val pts = BoardGeometry.wobblePolyline(
          BoardGeometry.ellipsePolygon(w, h, 40), shape.id, step = 18.0, amp = min(2.0, w / 40 + 0.6),
        )
        BoardGeometry.traceSmooth(sink, pts, closed = true)
        sink.close()
      } else {
        val rx = max(0.5, w / 2)
        val ry = max(0.5, h / 2)
        sink.addOval(w / 2 - rx, h / 2 - ry, w / 2 + rx, h / 2 + ry)
      }
      return
    }
    val polygon = BoardGeometry.geoPolygon(shape.geo, w, h)
    val pts = if (shape.dash == DashStyle.DRAW) {
      BoardGeometry.wobblePolyline(polygon, shape.id, step = 22.0, amp = min(2.2, (w + h) / 160 + 0.6))
    } else {
      polygon
    }
    val n = pts.size / 2
    sink.moveTo(pts[0], pts[1])
    for (i in 1 until n) sink.lineTo(pts[i * 2], pts[i * 2 + 1])
    sink.close()
  }

  /** Control point of a bent connector: `bend * 2` along the chord normal puts the curve at `bend`. */
  fun controlPoint(shape: ConnectorShape): BoardPoint {
    val len = chordLength(shape)
    val nx = -shape.dy / len
    val ny = shape.dx / len
    return BoardPoint(shape.dx / 2 + nx * shape.bend * 2, shape.dy / 2 + ny * shape.bend * 2)
  }

  /** The connector's body: straight, or one quadratic when bent. */
  fun connectorBody(sink: PathSink, shape: ConnectorShape) {
    sink.moveTo(0.0, 0.0)
    if (shape.bend != 0.0) {
      val c = controlPoint(shape)
      sink.quadTo(c.x, c.y, shape.dx, shape.dy)
    } else {
      sink.lineTo(shape.dx, shape.dy)
    }
  }

  /**
   * The arrow's chevron, aligned with the end tangent: flat `[x0, y0, tipX,
   * tipY, x1, y1]`, stroked as an open polyline.
   */
  fun arrowHead(shape: ConnectorShape): DoubleArray {
    val w = shape.size.strokeWidth
    val len = chordLength(shape)
    val angle = if (shape.bend != 0.0) {
      val c = controlPoint(shape)
      atan2(shape.dy - c.y, shape.dx - c.x)
    } else {
      atan2(shape.dy, shape.dx)
    }
    val headLength = min(max(w * 3.2, 12.0), len * 0.4)
    return doubleArrayOf(
      shape.dx - cos(angle - 0.5) * headLength,
      shape.dy - sin(angle - 0.5) * headLength,
      shape.dx,
      shape.dy,
      shape.dx - cos(angle + 0.5) * headLength,
      shape.dy - sin(angle + 0.5) * headLength,
    )
  }

  /** QuickDraw's `Math.hypot(dx, dy) || 1`. */
  private fun chordLength(shape: ConnectorShape): Double {
    val len = hypot(shape.dx, shape.dy)
    return if (len == 0.0) 1.0 else len
  }
}
