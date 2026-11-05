package com.margelo.nitro.forgeboard.whiteboard

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Ports of the `geometry.js` builders the renderer needs (QuickDraw 0.2.0). */
internal object BoardGeometry {
  /** `geoPolygon`: the outline of a non-ellipse geo kind in a `w` x `h` box, flat `[x, y, ...]`. */
  fun geoPolygon(geo: GeoKind, w: Double, h: Double): DoubleArray =
    when (geo) {
      GeoKind.TRIANGLE -> doubleArrayOf(w / 2, 0.0, w, h, 0.0, h)
      GeoKind.DIAMOND -> doubleArrayOf(w / 2, 0.0, w, h / 2, w / 2, h, 0.0, h / 2)
      GeoKind.HEXAGON -> {
        val ix = w * 0.25
        doubleArrayOf(ix, 0.0, w - ix, 0.0, w, h / 2, w - ix, h, ix, h, 0.0, h / 2)
      }
      GeoKind.STAR -> {
        val cx = w / 2
        val cy = h / 2
        val out = DoubleArray(20)
        for (i in 0 until 10) {
          val r = if (i % 2 == 0) 1.0 else 0.45
          val a = -PI / 2 + i * PI / 5
          out[i * 2] = cx + cos(a) * r * cx
          out[i * 2 + 1] = cy + sin(a) * r * cy
        }
        out
      }
      GeoKind.RECTANGLE, GeoKind.ELLIPSE -> doubleArrayOf(0.0, 0.0, w, 0.0, w, h, 0.0, h)
    }

  /** `ellipsePolygon`: an ellipse in a `w` x `h` box sampled as [n] points. */
  fun ellipsePolygon(w: Double, h: Double, n: Int): DoubleArray {
    val out = DoubleArray(n * 2)
    for (i in 0 until n) {
      val a = i.toDouble() / n * PI * 2
      out[i * 2] = w / 2 + cos(a) * w / 2
      out[i * 2 + 1] = h / 2 + sin(a) * h / 2
    }
    return out
  }

  /** `wobblePolyline` with `closed = true`: the seeded hand-drawn resample of a closed polygon. */
  fun wobblePolyline(pts: DoubleArray, seed: String, step: Double, amp: Double): DoubleArray {
    val rand = SeededRandom(seed)
    val out = ArrayList<Double>()
    val n = pts.size / 2
    var ph = rand.next() * PI * 2
    val freq = 0.35 + rand.next() * 0.2
    for (i in 0 until n) {
      val ax = pts[(i % n) * 2]
      val ay = pts[(i % n) * 2 + 1]
      val bx = pts[((i + 1) % n) * 2]
      val by = pts[((i + 1) % n) * 2 + 1]
      val len = hypot(bx - ax, by - ay)
      val count = max(1, jsRound(len / step))
      val safeLen = if (len == 0.0) 1.0 else len
      val nx = -(by - ay) / safeLen
      val ny = (bx - ax) / safeLen
      for (k in 0 until count) {
        val t = k.toDouble() / count
        val w = (if (k == 0) 0.3 else 1.0) * sin(ph) * amp
        ph += freq
        out.add(ax + (bx - ax) * t + nx * w)
        out.add(ay + (by - ay) * t + ny * w)
      }
    }
    return out.toDoubleArray()
  }

  /**
   * `traceSmooth`: a path through flat `[x, y, ...]` points with midpoint
   * quadratics. Fewer than three points become straight segments.
   */
  fun traceSmooth(sink: PathSink, pts: DoubleArray, closed: Boolean) {
    val n = pts.size / 2
    if (n < 1) return
    sink.moveTo(pts[0], pts[1])
    if (n < 3) {
      for (i in 1 until n) sink.lineTo(pts[i * 2], pts[i * 2 + 1])
      return
    }
    for (i in 1 until n - 1) {
      val x = pts[i * 2]
      val y = pts[i * 2 + 1]
      val nx = pts[(i + 1) * 2]
      val ny = pts[(i + 1) * 2 + 1]
      sink.quadTo(x, y, (x + nx) / 2, (y + ny) / 2)
    }
    sink.lineTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
    if (closed) sink.close()
  }

  /** The `[x, y]` pairs of a `[x, y, pressure, ...]` triplet list. */
  fun xyOfTriplets(pts: DoubleArray): DoubleArray {
    val n = pts.size / 3
    val out = DoubleArray(n * 2)
    for (i in 0 until n) {
      out[i * 2] = pts[i * 3]
      out[i * 2 + 1] = pts[i * 3 + 1]
    }
    return out
  }

  /** `ptsBounds` for a `[x, y, pressure, ...]` triplet list. */
  fun tripletBounds(pts: DoubleArray): BoardRect {
    if (pts.size < 2) return BoardRect(0.0, 0.0, 0.0, 0.0)
    var minX = Double.POSITIVE_INFINITY
    var minY = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY
    var maxY = Double.NEGATIVE_INFINITY
    var i = 0
    while (i < pts.size - 1) {
      val x = pts[i]
      val y = pts[i + 1]
      minX = min(minX, x)
      maxX = max(maxX, x)
      minY = min(minY, y)
      maxY = max(maxY, y)
      i += 3
    }
    return BoardRect(minX, minY, maxX - minX, maxY - minY)
  }

  /** JS `Math.round`: halves round towards +infinity. */
  private fun jsRound(value: Double): Int = kotlin.math.floor(value + 0.5).roundToInt()
}
