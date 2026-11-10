package com.margelo.nitro.forgeboard.whiteboard

/** QuickDraw `FONTS` ids. The renderer maps each to an Android typeface family. */
internal enum class BoardFont(val id: String) {
  DRAW("draw"),
  SANS("sans"),
  SERIF("serif"),
  MONO("mono");

  companion object {
    /** QuickDraw treats a missing font as `draw`. @return null for an id it does not define. */
    fun fromId(id: String?): BoardFont? {
      if (id == null) return DRAW
      return entries.firstOrNull { it.id == id }
    }
  }
}
