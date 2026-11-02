package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardJsonParserTest {
  private val draw = """{"id":"shape:a","typeName":"shape","type":"draw","x":1,"y":2,"rot":0,"z":3,
    "props":{"pts":[0,0,0.5,4,3,0.5],"color":"blue","size":"l","dash":"draw","done":true},"inkOutline":[0,0,1,1,2,0]}"""
  private val arrow = """{"id":"shape:b","typeName":"shape","type":"arrow","x":0,"y":0,"rot":0.5,"z":4,
    "props":{"dx":10,"dy":5,"bend":2,"color":"red","size":"s","dash":"dashed"}}"""
  private val asset = """{"id":"asset:1","typeName":"asset","src":"data:image/png;base64,AAAA","w":1,"h":1}"""

  @Test
  fun parsesASnapshotOfShapesAndAssets() {
    val records = BoardJsonParser.parseSnapshot("""{"document":{"store":{"shape:a":$draw,"shape:b":$arrow,"asset:1":$asset}}}""")
    val byId = records.associateBy { it.id }
    val d = byId.getValue("shape:a") as DrawShape
    assertEquals(InkColor.BLUE, d.color)
    assertEquals(StrokeSize.L, d.size)
    assertArrayEquals(doubleArrayOf(0.0, 0.0, 1.0, 1.0, 2.0, 0.0), d.inkOutline, 0.0)
    assertTrue(d.isDone)
    val a = byId.getValue("shape:b") as ConnectorShape
    assertTrue(a.hasArrowHead)
    assertEquals(DashStyle.DASHED, a.dash)
    assertEquals(0.5, a.rot, 0.0)
    assertEquals("data:image/png;base64,AAAA", (byId.getValue("asset:1") as BoardAsset).src)
  }

  @Test
  fun readsOnlyTheNewSideOfUpdatesAndTheKeysOfRemovals() {
    val diff = BoardJsonParser.parseDiff("""{"added":{},"updated":{"shape:b":[null,$arrow]},"removed":{"shape:x":null}}""")
    assertEquals(listOf("shape:b"), diff.puts.map { it.id })
    assertEquals(listOf("shape:x"), diff.removedIds)
  }

  @Test
  fun skipsRecordKindsItDoesNotKnow() {
    val records = BoardJsonParser.parseSnapshot(
      """{"document":{"store":{"s":{"id":"s","typeName":"shape","type":"frame","x":0,"y":0,"props":{}},"p":{"id":"p","typeName":"page"}}}}""",
    )
    assertTrue(records.isEmpty())
  }

  @Test
  fun rejectsInkWithoutAnOutline() {
    val noOutline = draw.replace(""","inkOutline":[0,0,1,1,2,0]""", "")
    val error = expectThrows<BoardParseException> {
      BoardJsonParser.parseDiff("""{"added":{"shape:a":$noOutline},"updated":{},"removed":{}}""")
    }
    assertTrue(error.message!!.contains("getInkOutline"))
  }

  @Test
  fun acceptsADashedDrawWithoutAnOutline() {
    val dashed = draw.replace("\"dash\":\"draw\"", "\"dash\":\"dotted\"").replace(""","inkOutline":[0,0,1,1,2,0]""", "")
    val diff = BoardJsonParser.parseDiff("""{"added":{"shape:a":$dashed}}""")
    assertNull((diff.puts.single() as DrawShape).inkOutline)
  }

  @Test
  fun rejectsMalformedInputWithoutPartialResults() {
    val cases = listOf(
      "not json",
      "[]",
      """{"document":{}}""",
      """{"added":{"shape:a":${draw.replace("\"x\":1", "\"x\":\"1\"")}}}""",
      """{"added":{"shape:a":${draw.replace("\"color\":\"blue\"", "\"color\":\"magenta\"")}}}""",
      """{"added":{"shape:a":${draw.replace("[0,0,0.5,4,3,0.5]", "[0,0,0.5,4]")}}}""",
      """{"updated":{"shape:b":[$arrow]}}""",
      """{"added":{"shape:a":${draw.replace("\"id\":\"shape:a\"", "\"id\":\"\"")}}}""",
    )
    for (json in cases) {
      expectThrows<BoardParseException>("expected rejection: $json") {
        if (json.contains("document")) BoardJsonParser.parseSnapshot(json) else BoardJsonParser.parseDiff(json)
      }
    }
  }

  @Test
  fun appliesQuickDrawDefaults() {
    val geo = """{"id":"g","typeName":"shape","type":"geo","x":0,"y":0,"props":{"w":10,"h":5}}"""
    val shape = BoardJsonParser.parseDiff("""{"added":{"g":$geo}}""").puts.single() as GeoShape
    assertEquals(InkColor.BLACK, shape.color)
    assertEquals(StrokeSize.M, shape.size)
    assertEquals(FillStyle.NONE, shape.fill)
    assertEquals(GeoKind.RECTANGLE, shape.geo)
    assertEquals(StrokeSize.S, shape.labelSize)
    assertEquals(0.0, shape.rot, 0.0)
  }

  @Test
  fun fixedWidthTextNeedsAutosizeFalseAndAWidth() {
    val text = """{"id":"t","typeName":"shape","type":"text","x":0,"y":0,"props":{"text":"hi","autosize":false,"w":120,"scale":0}}"""
    val shape = BoardJsonParser.parseDiff("""{"added":{"t":$text}}""").puts.single() as TextShape
    assertEquals(120.0, shape.fixedWidth!!, 0.0)
    assertEquals(1.0, shape.scale, 0.0)
    val auto = text.replace("\"autosize\":false,", "")
    assertNull((BoardJsonParser.parseDiff("""{"added":{"t":$auto}}""").puts.single() as TextShape).fixedWidth)
  }

  @Test
  fun parsesTheHeadlessBoardOverlay() {
    val overlay = BoardJsonParser.parseOverlay(
      """{"selection":{"kind":"box","ids":["a"],"bounds":{"x":1,"y":2,"w":3,"h":4},"isResizable":true,"isRotatable":false},
        "marquees":[{"x":0,"y":0,"w":5,"h":5}],
        "laserStrokes":[{"id":"l","points":[{"x":1,"y":1},{"x":2,"y":3}],"opacity":0.5}],
        "eraserTrails":[{"pointerId":1,"points":[0,0,4,4]}],
        "pendingEraseIds":["a"]}""",
    )
    val box = overlay.selection as OverlayBoxSelection
    assertEquals(BoardRect(1.0, 2.0, 3.0, 4.0), box.bounds)
    assertEquals(1, overlay.marquees.size)
    assertArrayEquals(doubleArrayOf(1.0, 1.0, 2.0, 3.0), overlay.laserStrokes.single().points, 0.0)
    assertEquals(setOf("a"), overlay.pendingEraseIds)
  }

  @Test
  fun rejectsAnOverlayWithAnUnknownSelectionKind() {
    expectThrows<BoardParseException> {
      BoardJsonParser.parseOverlay("""{"selection":{"kind":"lasso"}}""")
    }
  }
}
