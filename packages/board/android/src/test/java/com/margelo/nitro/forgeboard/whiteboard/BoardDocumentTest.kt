package com.margelo.nitro.forgeboard.whiteboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BoardDocumentTest {
  private fun geo(id: String, z: Double) =
    GeoShape(id, 0.0, 0.0, 0.0, z, InkColor.BLACK, StrokeSize.M, DashStyle.SOLID, FillStyle.NONE, GeoKind.RECTANGLE, 1.0, 1.0, "", StrokeSize.S, BoardFont.DRAW)

  private fun highlight(id: String, z: Double) =
    HighlightShape(id, 0.0, 0.0, 0.0, z, InkColor.YELLOW, StrokeSize.M, doubleArrayOf(0.0, 0.0, 0.5))

  @Test
  fun drawsHighlightsFirstThenByZThenId() {
    val doc = BoardDocument()
    doc.replaceAll(listOf(geo("b", 1.0), highlight("h", 9.0), geo("a", 1.0), geo("c", 0.0)), 1.0)
    assertEquals(listOf("h", "c", "a", "b"), doc.sortedShapes().map { it.shape.id })
  }

  @Test
  fun appliesPutsThenRemovalsAndStampsTheRevision() {
    val doc = BoardDocument()
    doc.replaceAll(listOf(geo("a", 1.0), geo("b", 2.0)), 1.0)
    doc.apply(BoardDiff(listOf(geo("a", 5.0), geo("c", 3.0)), listOf("b")), 2.0)
    assertEquals(listOf("c", "a"), doc.sortedShapes().map { it.shape.id })
    assertEquals(2.0, doc.shape("a")!!.revision, 0.0)
    assertNull(doc.shape("b"))
  }

  @Test
  fun aSnapshotReplacesEverything() {
    val doc = BoardDocument()
    doc.replaceAll(listOf(geo("a", 1.0)), 1.0)
    doc.apply(BoardDiff(listOf(BoardAsset("asset:1", "data:")), emptyList()), 2.0)
    doc.replaceAll(listOf(geo("z", 1.0)), 3.0)
    assertEquals(setOf("z"), doc.shapeIds())
    assertEquals(emptySet<String>(), doc.assetIds())
  }
}
