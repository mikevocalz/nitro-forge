package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertEquals
import org.junit.Test

class SeededRandomTest {
  @Test
  fun matchesQuickDrawSeededRandBitForBit() {
    // node: seededRand("shape:abc123") from @quickdrawjs/core 0.2.0 geometry.js
    val expected = doubleArrayOf(0.45636383141390979, 0.046700377250090241, 0.33915503392927349, 0.94359497656114399)
    val random = SeededRandom("shape:abc123")
    for (value in expected) assertEquals(value, random.next(), 0.0)
  }
}
