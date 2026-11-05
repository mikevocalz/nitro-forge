package ai.nitroforge.reservedregions

import io.github.expo.modules.v2.Record

/** Interactive-content margins of a reserved region. Always zero on Android. */
@Record
data class RegionMarginsRecord(
  val top: Double,
  val left: Double,
  val bottom: Double,
  val right: Double,
)
