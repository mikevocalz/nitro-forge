package com.margelo.nitro.forgeboard.whiteboard

/** QuickDraw sizes (`palette.js` SIZES, FONT_SIZES, NOTE_FONT_SIZES), in page units. */
internal enum class StrokeSize(
  val id: String,
  val strokeWidth: Double,
  val fontSize: Double,
  val noteFontSize: Double,
) {
  S("s", 2.5, 20.0, 16.0),
  M("m", 4.0, 26.0, 20.0),
  L("l", 6.5, 36.0, 26.0),
  XL("xl", 10.0, 48.0, 32.0);

  companion object {
    /** @return [fallback] for a missing id, null for an id QuickDraw does not define. */
    fun fromId(id: String?, fallback: StrokeSize = M): StrokeSize? {
      if (id == null) return fallback
      return entries.firstOrNull { it.id == id }
    }
  }
}
