package com.margelo.nitro.forgeboard.whiteboard

/** QuickDraw `GEO_IDS`. */
internal enum class GeoKind(val id: String) {
  RECTANGLE("rectangle"),
  ELLIPSE("ellipse"),
  TRIANGLE("triangle"),
  DIAMOND("diamond"),
  HEXAGON("hexagon"),
  STAR("star");

  companion object {
    /** `geometry.js` draws a missing or unknown kind as a rectangle. */
    fun fromId(id: String?): GeoKind = entries.firstOrNull { it.id == id } ?: RECTANGLE
  }
}
