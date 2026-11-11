package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.fail

/** JUnit 4.12-compatible `assertThrows`: runs [block] and returns the [T] it threw. */
internal inline fun <reified T : Throwable> expectThrows(message: String = "", block: () -> Unit): T {
  try {
    block()
  } catch (error: Throwable) {
    if (error is T) return error
    throw AssertionError("$message: expected ${T::class.java.simpleName}, got $error", error)
  }
  fail("$message: expected ${T::class.java.simpleName}, nothing was thrown")
  throw IllegalStateException("unreachable")
}
