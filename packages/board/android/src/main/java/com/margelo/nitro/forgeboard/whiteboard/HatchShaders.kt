package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader

/**
 * `hatchPattern` in `shapes.js`: an 8 x 8 tile of 45° lines at 55% alpha,
 * repeated, one per stroke colour. Render thread only.
 */
internal class HatchShaders {
  private val shaders = HashMap<Int, BitmapShader>()
  private val bitmaps = ArrayList<Bitmap>()

  fun shaderFor(strokeArgb: Int): BitmapShader {
    shaders[strokeArgb]?.let { return it }
    val tile = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      color = strokeArgb
      alpha = (0.55 * 255).toInt()
      strokeWidth = 1.4f
    }
    Canvas(tile).apply {
      drawLine(-2f, 6f, 6f, -2f, paint)
      drawLine(2f, 10f, 10f, 2f, paint)
    }
    bitmaps.add(tile)
    val shader = BitmapShader(tile, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
    shaders[strokeArgb] = shader
    return shader
  }

  fun clear() {
    shaders.clear()
    for (bitmap in bitmaps) bitmap.recycle()
    bitmaps.clear()
  }
}
