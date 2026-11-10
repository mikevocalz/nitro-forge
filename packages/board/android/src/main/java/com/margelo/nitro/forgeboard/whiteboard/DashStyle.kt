package com.margelo.nitro.forgeboard.whiteboard

/** QuickDraw `DASH_IDS`. */
internal enum class DashStyle(val id: String) {
  DRAW("draw"),
  SOLID("solid"),
  DASHED("dashed"),
  DOTTED("dotted");

  companion object {
    /** @return [fallback] for a missing id, null for an id QuickDraw does not define. */
    fun fromId(id: String?, fallback: DashStyle = DRAW): DashStyle? {
      if (id == null) return fallback
      return entries.firstOrNull { it.id == id }
    }
  }
}
