package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import com.margelo.nitro.forgeboard.BoardCamera
import kotlin.math.cos
import kotlin.math.sin

/**
 * `_renderOverlay` from `editor.js` (QuickDraw 0.2.0): selection chrome,
 * marquees, eraser trails and laser trails. The canvas is in view units
 * (board units before the camera); page points are mapped with the camera
 * here so line widths stay constant at any zoom. Render thread only.
 */
internal class OverlayPainter(private val bounds: ShapeBounds) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val path = Path()

  fun draw(canvas: Canvas, overlay: BoardOverlayState, camera: BoardCamera, document: BoardDocument) {
    when (val selection = overlay.selection) {
      is OverlayLineSelection -> drawLineSelection(canvas, selection, camera)
      is OverlayBoxSelection -> drawBoxSelection(canvas, selection, camera, document)
      null -> Unit
    }
    for (rect in overlay.marquees) drawMarquee(canvas, rect, camera)
    for (trail in overlay.eraserTrails) drawEraserTrail(canvas, trail, camera)
    for (laser in overlay.laserStrokes) drawLaser(canvas, laser, camera)
  }

  private fun drawLineSelection(canvas: Canvas, selection: OverlayLineSelection, camera: BoardCamera) {
    for (p in listOf(selection.start, selection.end, selection.bend)) {
      handleCircle(canvas, viewX(p.x, camera), viewY(p.y, camera))
    }
  }

  private fun drawBoxSelection(canvas: Canvas, selection: OverlayBoxSelection, camera: BoardCamera, document: BoardDocument) {
    val single = if (selection.ids.size == 1) document.shape(selection.ids[0])?.shape else null
    val isRotatedSingle = single != null && single.rot != 0.0
    if (single != null && isRotatedSingle) {
      val lb = bounds.localBounds(single)
      val cx = single.x + lb.x + lb.w / 2
      val cy = single.y + lb.y + lb.h / 2
      val s = sin(single.rot)
      val c = cos(single.rot)
      path.reset()
      for (corner in 0 until 4) {
        val px = single.x + lb.x + if (corner == 1 || corner == 2) lb.w else 0.0
        val py = single.y + lb.y + if (corner >= 2) lb.h else 0.0
        val rx = cx + (px - cx) * c - (py - cy) * s
        val ry = cy + (px - cx) * s + (py - cy) * c
        val vx = viewX(rx, camera)
        val vy = viewY(ry, camera)
        if (corner == 0) path.moveTo(vx, vy) else path.lineTo(vx, vy)
      }
      path.close()
      selectionStroke(1.5f)
      canvas.drawPath(path, paint)
    }
    val b = selection.bounds
    val left = viewX(b.x, camera)
    val top = viewY(b.y, camera)
    val right = viewX(b.x + b.w, camera)
    val bottom = viewY(b.y + b.h, camera)
    if (!isRotatedSingle) {
      selectionStroke(1.5f)
      canvas.drawRect(left, top, right, bottom, paint)
    }
    if (selection.isRotatable) {
      val rx = (left + right) / 2
      val ry = top - 22
      selectionStroke(1.5f)
      canvas.drawLine(rx, top, rx, ry + 5, paint)
      handleCircle(canvas, rx, ry)
    }
    if (selection.isResizable && !isRotatedSingle) {
      val midX = (left + right) / 2
      val midY = (top + bottom) / 2
      val handles = floatArrayOf(left, top, right, top, left, bottom, right, bottom, midX, top, midX, bottom, left, midY, right, midY)
      for (i in handles.indices step 2) handleSquare(canvas, handles[i], handles[i + 1])
    }
  }

  private fun drawMarquee(canvas: Canvas, rect: BoardRect, camera: BoardCamera) {
    val left = viewX(rect.x, camera)
    val top = viewY(rect.y, camera)
    val right = left + (rect.w * camera.z).toFloat()
    val bottom = top + (rect.h * camera.z).toFloat()
    paint.reset()
    paint.isAntiAlias = true
    paint.style = Paint.Style.FILL
    paint.color = BoardPalette.SELECTION_FILL
    canvas.drawRect(left, top, right, bottom, paint)
    selectionStroke(1f)
    canvas.drawRect(left, top, right, bottom, paint)
  }

  private fun drawEraserTrail(canvas: Canvas, trail: DoubleArray, camera: BoardCamera) {
    if (trail.size <= 2) return
    polyline(trail, camera)
    roundStroke(BoardPalette.ERASER_TRAIL, 5f)
    canvas.drawPath(path, paint)
  }

  private fun drawLaser(canvas: Canvas, laser: OverlayLaserStroke, camera: BoardCamera) {
    if (laser.points.size < 4) return
    polyline(laser.points, camera)
    roundStroke(BoardPalette.SCRIBBLE, 3.5f)
    paint.alpha = (laser.opacity * 255).toInt()
    // CSS shadowBlur 9 is a Gaussian sigma of 4.5; setShadowLayer takes a radius.
    paint.setShadowLayer(4.5f, 0f, 0f, BoardPalette.SCRIBBLE)
    canvas.drawPath(path, paint)
    paint.clearShadowLayer()
  }

  private fun polyline(flat: DoubleArray, camera: BoardCamera) {
    path.reset()
    for (i in flat.indices step 2) {
      val x = viewX(flat[i], camera)
      val y = viewY(flat[i + 1], camera)
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
  }

  private fun handleCircle(canvas: Canvas, x: Float, y: Float) {
    handleFill()
    canvas.drawCircle(x, y, 5f, paint)
    selectionStroke(1.5f)
    canvas.drawCircle(x, y, 5f, paint)
  }

  private fun handleSquare(canvas: Canvas, x: Float, y: Float) {
    handleFill()
    canvas.drawRect(x - 4.5f, y - 4.5f, x + 4.5f, y + 4.5f, paint)
    selectionStroke(1.5f)
    canvas.drawRect(x - 4.5f, y - 4.5f, x + 4.5f, y + 4.5f, paint)
  }

  private fun handleFill() {
    paint.reset()
    paint.isAntiAlias = true
    paint.style = Paint.Style.FILL
    paint.color = BoardPalette.HANDLE_FILL
  }

  private fun selectionStroke(width: Float) {
    paint.reset()
    paint.isAntiAlias = true
    paint.style = Paint.Style.STROKE
    paint.color = BoardPalette.SELECTION
    paint.strokeWidth = width
  }

  private fun roundStroke(argb: Int, width: Float) {
    paint.reset()
    paint.isAntiAlias = true
    paint.style = Paint.Style.STROKE
    paint.color = argb
    paint.strokeWidth = width
    paint.strokeCap = Paint.Cap.ROUND
    paint.strokeJoin = Paint.Join.ROUND
  }

  /** `pageToScreen`: `(page + camera) * z`. */
  private fun viewX(pageX: Double, camera: BoardCamera): Float = ((pageX + camera.x) * camera.z).toFloat()

  private fun viewY(pageY: Double, camera: BoardCamera): Float = ((pageY + camera.y) * camera.z).toFloat()
}
