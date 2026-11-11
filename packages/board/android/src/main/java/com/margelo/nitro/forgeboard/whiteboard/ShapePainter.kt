package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Path

/**
 * `drawShape` from `shapes.js` (QuickDraw 0.2.0), one branch per shape type.
 * The canvas is already in page space; this applies the shape's own rotate
 * and translate. Paint objects are reused across shapes. Render thread only.
 */
internal class ShapePainter(
  private val layouts: TextLayoutEngine,
  private val bounds: ShapeBounds,
  private val paths: ShapePathCache,
  private val assets: AssetBitmaps,
  private val hatches: HatchShaders,
) {
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG)
  private val text = Paint(Paint.ANTI_ALIAS_FLAG)
  private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val scratchPath = Path()
  private val scratchRect = RectF()
  private val srcRect = Rect()

  /** @param isGhost draw at 30% alpha: the shape is about to be erased. */
  fun draw(canvas: Canvas, placed: PlacedShape, document: BoardDocument, isGhost: Boolean) {
    val shape = placed.shape
    val alpha = if (isGhost) 0.3 else 1.0
    canvas.save()
    if (shape.rot != 0.0) {
      val lb = bounds.localBounds(shape)
      val cx = (shape.x + lb.x + lb.w / 2).toFloat()
      val cy = (shape.y + lb.y + lb.h / 2).toFloat()
      canvas.rotate(Math.toDegrees(shape.rot).toFloat(), cx, cy)
    }
    canvas.translate(shape.x.toFloat(), shape.y.toFloat())
    when (shape) {
      is DrawShape -> drawInk(canvas, shape, placed, alpha)
      is HighlightShape -> drawHighlight(canvas, shape, placed, alpha)
      is GeoShape -> drawGeo(canvas, shape, placed, alpha)
      is ConnectorShape -> drawConnector(canvas, shape, placed, alpha)
      is TextShape -> drawText(canvas, shape, alpha)
      is NoteShape -> drawNote(canvas, shape, alpha)
      is ImageShape -> drawImage(canvas, shape, document, alpha)
    }
    canvas.restore()
  }

  fun clear() {
    paths.clear()
    assets.clear()
    hatches.clear()
    layouts.clear()
  }

  private fun drawInk(canvas: Canvas, shape: DrawShape, placed: PlacedShape, alpha: Double) {
    val body = paths.pathsFor(placed)?.body ?: return
    if (shape.inkOutline != null) {
      resetFill(shape.color.stroke, alpha)
      canvas.drawPath(body, fill)
    } else {
      resetStroke(shape.color.stroke, alpha, shape.size.strokeWidth, shape.dash)
      canvas.drawPath(body, stroke)
    }
  }

  private fun drawHighlight(canvas: Canvas, shape: HighlightShape, placed: PlacedShape, alpha: Double) {
    val body = paths.pathsFor(placed)?.body ?: return
    resetStroke(shape.color.stroke, alpha * BoardPalette.HIGHLIGHT_ALPHA, shape.size.strokeWidth * BoardPalette.HIGHLIGHT_SCALE, DashStyle.SOLID)
    // Multiply soaks into light paper, as QuickDraw's light theme does.
    stroke.blendMode = BlendMode.MULTIPLY
    canvas.drawPath(body, stroke)
    stroke.blendMode = null
  }

  private fun drawGeo(canvas: Canvas, shape: GeoShape, placed: PlacedShape, alpha: Double) {
    val body = paths.pathsFor(placed)?.body ?: return
    when (shape.fill) {
      FillStyle.NONE -> Unit
      FillStyle.SEMI -> {
        resetFill(BoardPalette.SEMI, alpha)
        canvas.drawPath(body, fill)
      }
      FillStyle.SOLID -> {
        resetFill(shape.color.fill, alpha)
        canvas.drawPath(body, fill)
      }
      FillStyle.PATTERN -> {
        resetFill(0xFF000000.toInt(), alpha)
        fill.shader = hatches.shaderFor(shape.color.stroke)
        canvas.drawPath(body, fill)
        fill.shader = null
      }
    }
    resetStroke(shape.color.stroke, alpha, shape.size.strokeWidth, shape.dash)
    canvas.drawPath(body, stroke)
    val label = layouts.labelLayout(shape) ?: return
    drawLines(canvas, label, shape.color.stroke, alpha, Paint.Align.CENTER, shape.w / 2, shape.h / 2 - label.textHeight / 2)
  }

  private fun drawConnector(canvas: Canvas, shape: ConnectorShape, placed: PlacedShape, alpha: Double) {
    val built = paths.pathsFor(placed) ?: return
    resetStroke(shape.color.stroke, alpha, shape.size.strokeWidth, shape.dash)
    canvas.drawPath(built.body, stroke)
    val head = built.head ?: return
    // The chevron is never dashed; the join stays round, as in shapes.js.
    stroke.pathEffect = null
    canvas.drawPath(head, stroke)
  }

  private fun drawText(canvas: Canvas, shape: TextShape, alpha: Double) {
    val layout = layouts.textLayout(shape)
    val (align, anchor) = when (shape.align) {
      TextAlign.START -> Paint.Align.LEFT to 0.0
      TextAlign.MIDDLE -> Paint.Align.CENTER to layout.width / 2
      TextAlign.END -> Paint.Align.RIGHT to layout.width
    }
    drawLines(canvas, layout, shape.color.stroke, alpha, align, anchor, 0.0)
  }

  private fun drawNote(canvas: Canvas, shape: NoteShape, alpha: Double) {
    val layout = layouts.noteLayout(shape)
    val s = shape.scale.toFloat()
    canvas.scale(s, s)
    resetFill(shape.color.note, alpha)
    // CSS shadowBlur 10 is a Gaussian sigma of 5; setShadowLayer takes a radius.
    fill.setShadowLayer(5f, 0f, 4f, scaleAlpha(BoardPalette.NOTE_SHADOW, alpha))
    scratchRect.set(0f, 0f, BoardPalette.NOTE_W.toFloat(), layout.boxHeight.toFloat())
    canvas.drawRoundRect(scratchRect, 6f, 6f, fill)
    fill.clearShadowLayer()
    val top = maxOf(BoardPalette.NOTE_PAD, layout.boxHeight / 2 - layout.textHeight / 2)
    drawLines(canvas, layout, BoardPalette.NOTE_TEXT, alpha, Paint.Align.CENTER, BoardPalette.NOTE_W / 2, top)
  }

  private fun drawImage(canvas: Canvas, shape: ImageShape, document: BoardDocument, alpha: Double) {
    val asset = document.asset(shape.assetId)
    val bitmap = asset?.let { assets.bitmapFor(it) }
    scratchRect.set(0f, 0f, shape.w.toFloat(), shape.h.toFloat())
    if (bitmap == null) {
      resetFill(BoardPalette.SEMI, alpha)
      canvas.drawRoundRect(scratchRect, 4f, 4f, fill)
      return
    }
    scratchPath.reset()
    scratchPath.addRoundRect(scratchRect, 4f, 4f, Path.Direction.CW)
    canvas.save()
    canvas.clipPath(scratchPath)
    srcRect.set(0, 0, bitmap.width, bitmap.height)
    bitmapPaint.alpha = (alpha * 255).toInt()
    canvas.drawBitmap(bitmap, srcRect, scratchRect, bitmapPaint)
    canvas.restore()
  }

  /** Draws [layout]'s lines from the line box at [top], one `lineHeight` apart. */
  private fun drawLines(
    canvas: Canvas,
    layout: TextBlockLayout,
    argb: Int,
    alpha: Double,
    align: Paint.Align,
    anchorX: Double,
    top: Double,
  ) {
    text.reset()
    text.isAntiAlias = true
    text.typeface = BoardTypefaces.typeface(layout.font)
    text.textSize = layout.fontSize.toFloat()
    text.color = scaleAlpha(argb, alpha)
    text.textAlign = align
    var y = top + layouts.baseline(layout)
    for (line in layout.lines) {
      canvas.drawText(line.text, anchorX.toFloat(), y.toFloat(), text)
      y += layout.lineHeight
    }
  }

  private fun resetFill(argb: Int, alpha: Double) {
    fill.reset()
    fill.isAntiAlias = true
    fill.style = Paint.Style.FILL
    fill.color = scaleAlpha(argb, alpha)
  }

  /** `strokeStyled`: round joins and caps, QuickDraw's dash pattern for the width. */
  private fun resetStroke(argb: Int, alpha: Double, width: Double, dash: DashStyle) {
    stroke.reset()
    stroke.isAntiAlias = true
    stroke.style = Paint.Style.STROKE
    stroke.color = scaleAlpha(argb, alpha)
    stroke.strokeWidth = width.toFloat()
    stroke.strokeJoin = Paint.Join.ROUND
    stroke.strokeCap = Paint.Cap.ROUND
    stroke.pathEffect = when (dash) {
      DashStyle.DASHED -> DashPathEffect(floatArrayOf((width * 3.2).toFloat(), (width * 2.6).toFloat()), 0f)
      DashStyle.DOTTED -> DashPathEffect(floatArrayOf(0.01f, (width * 2.5).toFloat()), 0f)
      DashStyle.DRAW, DashStyle.SOLID -> null
    }
  }

  private fun scaleAlpha(argb: Int, alpha: Double): Int {
    val a = ((argb ushr 24) * alpha).toInt().coerceIn(0, 255)
    return (a shl 24) or (argb and 0x00FFFFFF)
  }
}
