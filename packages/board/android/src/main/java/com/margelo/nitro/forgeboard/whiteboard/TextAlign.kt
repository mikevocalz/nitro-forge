package com.margelo.nitro.forgeboard.whiteboard

/** QuickDraw text `align`. */
internal enum class TextAlign(val id: String) {
  START("start"),
  MIDDLE("middle"),
  END("end");

  companion object {
    /** QuickDraw treats a missing align as `start`. @return null for an id it does not define. */
    fun fromId(id: String?): TextAlign? {
      if (id == null) return START
      return entries.firstOrNull { it.id == id }
    }
  }
}
