package com.margelo.nitro.forgeboard.whiteboard

/** Parses `#RRGGBB` and `#RRGGBBAA` into ARGB. */
internal object HexColor {
  /** @throws IllegalArgumentException for any other format. */
  fun parse(value: String): Int {
    require(value.length == 7 || value.length == 9) { "Expected #RRGGBB or #RRGGBBAA, got \"$value\"" }
    require(value[0] == '#') { "Expected #RRGGBB or #RRGGBBAA, got \"$value\"" }
    val digits = value.substring(1)
    require(digits.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
      "Expected #RRGGBB or #RRGGBBAA, got \"$value\""
    }
    val rgb = digits.substring(0, 6).toInt(16)
    val alpha = if (digits.length == 8) digits.substring(6, 8).toInt(16) else 0xFF
    return (alpha shl 24) or rgb
  }
}
