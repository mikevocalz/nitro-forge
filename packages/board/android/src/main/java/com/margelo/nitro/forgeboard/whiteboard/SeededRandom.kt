package com.margelo.nitro.forgeboard.whiteboard

/**
 * QuickDraw's `seededRand` (`geometry.js`): mulberry32 seeded from a string
 * hash. Int arithmetic wraps like `Math.imul` and `| 0`, so the sequence is
 * bit-identical to the JS one for the same seed.
 */
internal class SeededRandom(seed: String) {
  private var state: Int

  init {
    var h = 1779033703 xor seed.length
    for (ch in seed) {
      h = (h xor ch.code) * MULTIPLIER
      h = (h shl 13) or (h ushr 19)
    }
    state = h
  }

  /** Next value in `[0, 1)`. */
  fun next(): Double {
    state += 0x6D2B79F5
    var t = (state xor (state ushr 15)) * (1 or state)
    t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
    val unsigned = (t xor (t ushr 14)).toLong() and 0xFFFFFFFFL
    return unsigned.toDouble() / 4294967296.0
  }

  private companion object {
    // 3432918353 does not fit an Int; JS `Math.imul` takes it modulo 2^32.
    const val MULTIPLIER = 3432918353L.toInt()
  }
}
