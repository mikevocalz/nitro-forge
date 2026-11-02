package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertEquals
import org.junit.Test

class RevisionGateTest {
  @Test
  fun acceptsOnlyStrictlyIncreasingRevisions() {
    val gate = RevisionGate()
    val ran = ArrayList<Double>()
    gate.admit(1.0) { ran.add(1.0) }
    gate.admit(5.0) { ran.add(5.0) }
    expectThrows<IllegalArgumentException> { gate.admit(5.0) { ran.add(5.0) } }
    expectThrows<IllegalArgumentException> { gate.admit(3.0) { ran.add(3.0) } }
    expectThrows<IllegalArgumentException> { gate.admit(Double.NaN) { ran.add(-1.0) } }
    gate.admit(6.0) { ran.add(6.0) }
    assertEquals(listOf(1.0, 5.0, 6.0), ran)
  }

  @Test
  fun aFailingActionDoesNotConsumeTheRevision() {
    val gate = RevisionGate()
    expectThrows<IllegalStateException> { gate.admit(2.0) { throw IllegalStateException("post failed") } }
    var ran = false
    gate.admit(2.0) { ran = true }
    assertEquals(true, ran)
  }
}
