package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Typeface

/**
 * Android stand-ins for QuickDraw's CSS font stacks, at weight 500 like
 * `shapes.js`. `draw` asks for the system `casual` family, the closest
 * handwriting face Android ships; the result depends on the device's fonts.
 */
internal object BoardTypefaces {
  private const val WEIGHT = 500

  private val faces: Map<BoardFont, Typeface> by lazy {
    mapOf(
      BoardFont.DRAW to Typeface.create(Typeface.create("casual", Typeface.NORMAL), WEIGHT, false),
      BoardFont.SANS to Typeface.create(Typeface.SANS_SERIF, WEIGHT, false),
      BoardFont.SERIF to Typeface.create(Typeface.SERIF, WEIGHT, false),
      BoardFont.MONO to Typeface.create(Typeface.MONOSPACE, WEIGHT, false),
    )
  }

  fun typeface(font: BoardFont): Typeface = faces.getValue(font)
}
