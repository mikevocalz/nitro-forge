package com.margelo.nitro.forgeboard.whiteboard

/** Light-theme constants from QuickDraw 0.2.0 `palette.js`, `shapes.js` and `editor.js`. */
internal object BoardPalette {
  const val HIGHLIGHT_ALPHA = 0.55
  const val HIGHLIGHT_SCALE = 4.5
  const val NOTE_W = 200.0
  const val NOTE_PAD = 20.0
  const val LABEL_PAD = 12.0

  /** `SEMI.light`: rgba(249, 247, 241, 0.85). */
  const val SEMI = 0xD9F9F7F1.toInt()
  const val NOTE_TEXT = 0xFF1D1D1D.toInt()
  /** rgba(20, 16, 8, 0.22): the note's drop shadow. */
  const val NOTE_SHADOW = 0x38141008

  const val SELECTION = 0xFF2F80EC.toInt()
  /** rgba(47, 128, 236, 0.07). */
  const val SELECTION_FILL = 0x122F80EC
  const val HANDLE_FILL = 0xFFFFFFFF.toInt()
  /** The laser pointer. */
  const val SCRIBBLE = 0xFFF2555A.toInt()
  /** rgba(0, 0, 0, 0.25): the eraser trail. */
  const val ERASER_TRAIL = 0x40000000
}
