package com.margelo.nitro.forgeboard.whiteboard

/** QuickDraw `FILL_IDS`. */
internal enum class FillStyle(val id: String) {
  NONE("none"),
  SEMI("semi"),
  SOLID("solid"),
  PATTERN("pattern");

  companion object {
    /** QuickDraw treats a missing fill as `none`. @return null for an id it does not define. */
    fun fromId(id: String?): FillStyle? {
      if (id == null) return NONE
      return entries.firstOrNull { it.id == id }
    }
  }
}
