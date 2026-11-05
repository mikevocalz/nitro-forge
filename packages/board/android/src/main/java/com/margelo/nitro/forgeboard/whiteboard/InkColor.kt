package com.margelo.nitro.forgeboard.whiteboard

/**
 * QuickDraw's twelve named colours in the light theme (`palette.js` LIGHT,
 * 0.2.0), as opaque ARGB. The board is always light paper.
 */
internal enum class InkColor(val id: String, val stroke: Int, val fill: Int, val note: Int) {
  BLACK("black", 0xFF1D1D1D.toInt(), 0xFFE8E8E8.toInt(), 0xFFFDF0A8.toInt()),
  GREY("grey", 0xFF9FA8B2.toInt(), 0xFFECEEF0.toInt(), 0xFFEFF0F2.toInt()),
  LIGHT_VIOLET("light-violet", 0xFFE085F4.toInt(), 0xFFF9EBFC.toInt(), 0xFFF5D9FB.toInt()),
  VIOLET("violet", 0xFFAE3EC9.toInt(), 0xFFF0DCF5.toInt(), 0xFFE5B9EF.toInt()),
  BLUE("blue", 0xFF4263EB.toInt(), 0xFFDFE5FB.toInt(), 0xFFC0CDF8.toInt()),
  LIGHT_BLUE("light-blue", 0xFF4DABF7.toInt(), 0xFFE0F0FE.toInt(), 0xFFC6E5FD.toInt()),
  YELLOW("yellow", 0xFFF1AC4B.toInt(), 0xFFFCEFDC.toInt(), 0xFFFBE5C0.toInt()),
  ORANGE("orange", 0xFFE16919.toInt(), 0xFFFAE5D5.toInt(), 0xFFF8CFAE.toInt()),
  GREEN("green", 0xFF099268.toInt(), 0xFFD3EBE3.toInt(), 0xFFB5E0D1.toInt()),
  LIGHT_GREEN("light-green", 0xFF4CB05E.toInt(), 0xFFDFF0E2.toInt(), 0xFFC5E7CC.toInt()),
  LIGHT_RED("light-red", 0xFFF87777.toInt(), 0xFFFDE4E4.toInt(), 0xFFFBCECE.toInt()),
  RED("red", 0xFFE03131.toInt(), 0xFFF9DCDC.toInt(), 0xFFF4B8B8.toInt());

  companion object {
    /** QuickDraw draws a missing colour as `black`. @return null for an id QuickDraw does not define. */
    fun fromId(id: String?): InkColor? {
      if (id == null) return BLACK
      return entries.firstOrNull { it.id == id }
    }
  }
}
