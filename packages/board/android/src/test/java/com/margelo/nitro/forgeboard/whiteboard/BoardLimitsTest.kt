package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardLimitsTest {
  private val small = BoardLimits(
    maxDocumentJsonChars = 2_000,
    maxOverlayJsonChars = 400,
    maxRecords = 3,
    maxArrayNumbers = 12,
    maxArrayItems = 4,
    maxTextChars = 10,
    maxExtent = 500.0,
  )

  private fun geo(id: String, w: Double = 40.0, h: Double = 30.0, label: String = "") =
    """{"id":"$id","typeName":"shape","type":"geo","x":0,"y":0,"props":{"geo":"rectangle","w":$w,"h":$h,"label":"$label","color":"black","size":"m","dash":"solid","fill":"none"}}"""

  private fun snapshot(vararg records: Pair<String, String>) =
    """{"document":{"store":{${records.joinToString(",") { (id, json) -> "\"$id\":$json" }}}}}"""

  private fun draw(pts: Int, outline: Int) =
    """{"id":"d","typeName":"shape","type":"draw","x":0,"y":0,"props":{"pts":[${List(pts) { "0" }.joinToString(",")}],"color":"blue","size":"m","dash":"draw"},"inkOutline":[${List(outline) { "0" }.joinToString(",")}]}"""

  @Test
  fun rejectsJsonLongerThanTheLimitBeforeParsing() {
    val padded = snapshot("a" to geo("a")) + " ".repeat(2_000)
    val error = expectThrows<BoardParseException> { BoardJsonParser.parseSnapshot(padded, small) }
    assertTrue(error.message!!.contains("2000"))
    expectThrows<BoardParseException> { BoardJsonParser.parseDiff("{}" + " ".repeat(2_000), small) }
    expectThrows<BoardParseException> { BoardJsonParser.parseOverlay("{}" + " ".repeat(400), small) }
  }

  @Test
  fun rejectsTooManyRecords() {
    val four = snapshot("a" to geo("a"), "b" to geo("b"), "c" to geo("c"), "d" to geo("d"))
    expectThrows<BoardParseException> { BoardJsonParser.parseSnapshot(four, small) }
    val diff = """{"added":{"a":${geo("a")},"b":${geo("b")}},"removed":{"x":null,"y":null}}"""
    expectThrows<BoardParseException>("added and removed count together") { BoardJsonParser.parseDiff(diff, small) }
    assertEquals(3, BoardJsonParser.parseSnapshot(snapshot("a" to geo("a"), "b" to geo("b"), "c" to geo("c")), small).size)
  }

  @Test
  fun rejectsPointArraysOverTheLimit() {
    assertEquals(1, BoardJsonParser.parseSnapshot(snapshot("d" to draw(pts = 12, outline = 12)), small).size)
    expectThrows<BoardParseException>("pts") { BoardJsonParser.parseSnapshot(snapshot("d" to draw(pts = 15, outline = 4)), small) }
    expectThrows<BoardParseException>("inkOutline") { BoardJsonParser.parseSnapshot(snapshot("d" to draw(pts = 3, outline = 14)), small) }
  }

  @Test
  fun rejectsTextOverTheLimit() {
    expectThrows<BoardParseException> { BoardJsonParser.parseSnapshot(snapshot("a" to geo("a", label = "x".repeat(11))), small) }
    val shape = BoardJsonParser.parseSnapshot(snapshot("a" to geo("a", label = "x".repeat(10))), small).single() as GeoShape
    assertEquals(10, shape.label.length)
  }

  @Test
  fun clampsHugeSizes() {
    val shape = BoardJsonParser.parseSnapshot(snapshot("a" to geo("a", w = 1e300, h = 20.0)), small).single() as GeoShape
    assertEquals(500.0, shape.w, 0.0)
    assertEquals(20.0, shape.h, 0.0)
  }

  @Test
  fun rejectsOverlayArraysOverTheLimit() {
    val trail = """{"points":[0,0]}"""
    expectThrows<BoardParseException> {
      BoardJsonParser.parseOverlay("""{"eraserTrails":[$trail,$trail,$trail,$trail,$trail]}""", small)
    }
    assertEquals(4, BoardJsonParser.parseOverlay("""{"eraserTrails":[$trail,$trail,$trail,$trail]}""", small).eraserTrails.size)
  }

  @Test
  fun defaultsLeaveRoomForLargeBoards() {
    val limits = BoardLimits()
    assertEquals(32 * 1024 * 1024, limits.maxDocumentJsonChars)
    assertTrue(limits.maxRecords >= 10_000)
    assertTrue(limits.maxArrayNumbers >= 100_000)
  }

  @Test
  fun drawFailuresThatLeaveTheVmUsableAreRecovered() {
    assertTrue(DrawFailures.isRecoverable(IllegalStateException("bad record")))
    assertTrue(DrawFailures.isRecoverable(OutOfMemoryError("bitmap")))
    assertTrue(DrawFailures.isRecoverable(StackOverflowError()))
    assertTrue(DrawFailures.isRecoverable(NoClassDefFoundError("android/graphics/X")))
    assertTrue(DrawFailures.isRecoverable(AssertionError("painter")))
    assertFalse(DrawFailures.isRecoverable(InternalError("vm")))
    assertFalse(DrawFailures.isRecoverable(UnknownError("vm")))
  }
}
