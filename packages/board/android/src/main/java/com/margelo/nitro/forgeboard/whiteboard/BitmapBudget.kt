package com.margelo.nitro.forgeboard.whiteboard

/**
 * Upper bound on the decoded bitmap bytes one renderer keeps. An asset that
 * would cross it is not decoded and draws QuickDraw's placeholder.
 */
internal class BitmapBudget(private val maxBytes: Long = MAX_BYTES) {
  /** Whether a bitmap of [nextBytes] fits next to [currentBytes]. An unknown (0) size never fits. */
  fun fits(currentBytes: Long, nextBytes: Long): Boolean = nextBytes > 0 && currentBytes + nextBytes <= maxBytes

  companion object {
    /** Six bitmaps at the 2048 px decode cap. */
    const val MAX_BYTES = 96L * 1024 * 1024

    /** ARGB_8888 bytes of a [widthPx] x [heightPx] image decoded with [sampleSize]; 0 when unknown. */
    fun estimatedBytes(widthPx: Int, heightPx: Int, sampleSize: Int): Long {
      if (widthPx <= 0 || heightPx <= 0 || sampleSize <= 0) return 0L
      return (widthPx / sampleSize).toLong() * (heightPx / sampleSize).toLong() * 4L
    }
  }
}
