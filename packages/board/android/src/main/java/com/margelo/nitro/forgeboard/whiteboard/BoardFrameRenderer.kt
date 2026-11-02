package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.RectF
import com.margelo.nitro.forgeboard.BoardCamera
import kotlin.math.min

/**
 * Draws one full frame: transparent clear, rounded paper, the document under
 * the camera and the overlay. Mirrors `renderScene` plus `_renderOverlay` in
 * `editor.js`, without the grid. Render thread only.
 */
internal class BoardFrameRenderer(private val config: RendererConfig) {
  private val layouts = TextLayoutEngine(PaintTextMeasurer())
  private val bounds = ShapeBounds(layouts)
  private val pathCache = ShapePathCache()
  private val assets = AssetBitmaps(AssetSourceResolver(AppFileRoots.current()))
  private val shapes = ShapePainter(layouts, bounds, pathCache, assets, HatchShaders())
  private val overlays = OverlayPainter(bounds)
  private val paperPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val paperPath = Path()
  private val paperRect = RectF()
  private var paperKey = 0L

  /**
   * Draws into [canvas], a Surface of [surfaceWidth] x [surfaceHeight] pixels.
   * A Surface whose size differs from the configured one is filled by the
   * same board area, scaled.
   */
  fun draw(
    canvas: Canvas,
    surfaceWidth: Int,
    surfaceHeight: Int,
    document: BoardDocument,
    camera: BoardCamera,
    overlay: BoardOverlayState,
  ) {
    canvas.drawColor(0, PorterDuff.Mode.CLEAR)
    val sx = surfaceWidth.toFloat() / config.widthPx
    val sy = surfaceHeight.toFloat() / config.heightPx
    updatePaper(surfaceWidth, surfaceHeight, sx)
    // Paper fill is anti-aliased by the paint, so its corners are smooth even
    // where the clip below is not.
    paperPaint.color = config.backgroundArgb
    canvas.drawPath(paperPath, paperPaint)

    canvas.save()
    canvas.clipPath(paperPath)
    canvas.scale((sx * config.pixelRatio).toFloat(), (sy * config.pixelRatio).toFloat())

    canvas.save()
    val z = camera.z.toFloat()
    canvas.scale(z, z)
    canvas.translate(camera.x.toFloat(), camera.y.toFloat())
    val pad = 64 / camera.z
    val visLeft = -camera.x - pad
    val visTop = -camera.y - pad
    val visRight = -camera.x + config.viewWidth / camera.z + pad
    val visBottom = -camera.y + config.viewHeight / camera.z + pad
    for (placed in document.sortedShapes()) {
      val pb = bounds.pageBounds(placed.shape)
      if (pb.x + pb.w < visLeft || pb.x > visRight || pb.y + pb.h < visTop || pb.y > visBottom) continue
      shapes.draw(canvas, placed, document, isGhost = placed.shape.id in overlay.pendingEraseIds)
    }
    canvas.restore()

    overlays.draw(canvas, overlay, camera, document)
    canvas.restore()
  }

  /** Drops cached paths and bitmaps for records no longer in [document]. */
  fun retain(document: BoardDocument) {
    pathCache.retainOnly(document.shapeIds())
    assets.retainOnly(document.assetIds())
  }

  fun bitmapBytes(): Long = assets.byteCount()

  fun release() {
    shapes.clear()
  }

  private fun updatePaper(width: Int, height: Int, scale: Float) {
    val radius = min((config.cornerRadiusPx * scale).toFloat(), min(width, height) / 2f)
    val key = (width.toLong() shl 32) or (height.toLong() and 0xFFFFFFFFL)
    if (key == paperKey && !paperPath.isEmpty) return
    paperKey = key
    paperRect.set(0f, 0f, width.toFloat(), height.toFloat())
    paperPath.reset()
    paperPath.addRoundRect(paperRect, radius, radius, Path.Direction.CW)
  }
}
