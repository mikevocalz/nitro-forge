package com.margelo.nitro.forgeboard.whiteboard

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** `localBounds` and `pageBounds` from `shapes.js` (QuickDraw 0.2.0). */
internal class ShapeBounds(private val layouts: TextLayoutEngine) {
  /** Bounds in the shape's local frame (origin at x/y, unrotated). */
  fun localBounds(shape: BoardShape): BoardRect =
    when (shape) {
      is DrawShape -> strokeBounds(shape.points, shape.size.strokeWidth * 0.75)
      is HighlightShape -> strokeBounds(shape.points, shape.size.strokeWidth * BoardPalette.HIGHLIGHT_SCALE / 2)
      is ConnectorShape -> {
        val bend = abs(shape.bend)
        BoardRect(
          min(0.0, shape.dx) - bend,
          min(0.0, shape.dy) - bend,
          abs(shape.dx) + bend * 2,
          abs(shape.dy) + bend * 2,
        )
      }
      is TextShape -> {
        val layout = layouts.textLayout(shape)
        BoardRect(0.0, 0.0, layout.width, layout.height)
      }
      is NoteShape -> {
        val layout = layouts.noteLayout(shape)
        BoardRect(0.0, 0.0, BoardPalette.NOTE_W * shape.scale, layout.boxHeight * shape.scale)
      }
      is ImageShape -> BoardRect(0.0, 0.0, shape.w, shape.h)
      is GeoShape -> BoardRect(0.0, 0.0, if (shape.w == 0.0) 1.0 else shape.w, if (shape.h == 0.0) 1.0 else shape.h)
    }

  /** Axis-aligned page bounds, rotation included. */
  fun pageBounds(shape: BoardShape): BoardRect {
    val lb = localBounds(shape)
    if (shape.rot == 0.0) return BoardRect(shape.x + lb.x, shape.y + lb.y, lb.w, lb.h)
    val cx = shape.x + lb.x + lb.w / 2
    val cy = shape.y + lb.y + lb.h / 2
    val s = sin(shape.rot)
    val c = cos(shape.rot)
    var minX = Double.POSITIVE_INFINITY
    var minY = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY
    var maxY = Double.NEGATIVE_INFINITY
    for (corner in 0 until 4) {
      val px = shape.x + lb.x + if (corner == 1 || corner == 2) lb.w else 0.0
      val py = shape.y + lb.y + if (corner >= 2) lb.h else 0.0
      val dx = px - cx
      val dy = py - cy
      val rx = cx + dx * c - dy * s
      val ry = cy + dx * s + dy * c
      minX = min(minX, rx)
      maxX = max(maxX, rx)
      minY = min(minY, ry)
      maxY = max(maxY, ry)
    }
    return BoardRect(minX, minY, maxX - minX, maxY - minY)
  }

  private fun strokeBounds(points: DoubleArray, margin: Double): BoardRect {
    val b = BoardGeometry.tripletBounds(points)
    return BoardRect(b.x - margin, b.y - margin, b.w + margin * 2, b.h + margin * 2)
  }
}
