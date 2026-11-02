package com.margelo.nitro.forgeboard.whiteboard

/**
 * The renderer's copy of the QuickDraw document. Owned by the render thread.
 *
 * Draw order is QuickDraw's `shapesSorted`: highlights first (under the
 * ink), then ascending `z`, then id.
 */
internal class BoardDocument {
  private val shapes = HashMap<String, PlacedShape>()
  private val assets = HashMap<String, BoardAsset>()
  private var sorted: List<PlacedShape>? = null

  val shapeCount: Int
    get() = shapes.size

  /** Replaces the whole document, as `Store.loadSnapshot`. */
  fun replaceAll(records: List<BoardRecord>, revision: Double) {
    shapes.clear()
    assets.clear()
    for (record in records) put(record, revision)
    sorted = null
  }

  /** Applies puts, then removals, as `Store.applyDiff`. */
  fun apply(diff: BoardDiff, revision: Double) {
    for (record in diff.puts) put(record, revision)
    for (id in diff.removedIds) {
      shapes.remove(id)
      assets.remove(id)
    }
    sorted = null
  }

  fun shape(id: String): PlacedShape? = shapes[id]

  fun asset(id: String): BoardAsset? = assets[id]

  fun shapeIds(): Set<String> = shapes.keys

  fun assetIds(): Set<String> = assets.keys

  fun sortedShapes(): List<PlacedShape> {
    sorted?.let { return it }
    val next = shapes.values.sortedWith(DRAW_ORDER)
    sorted = next
    return next
  }

  /** Doubles held by point, outline and text data, for `memorySize`. */
  fun estimatedBytes(): Long {
    var bytes = 0L
    for (placed in shapes.values) {
      bytes += 64
      when (val s = placed.shape) {
        is DrawShape -> bytes += (s.points.size + (s.inkOutline?.size ?: 0)) * 8L
        is HighlightShape -> bytes += s.points.size * 8L
        is TextShape -> bytes += s.text.length * 2L
        is NoteShape -> bytes += s.text.length * 2L
        is GeoShape -> bytes += s.label.length * 2L
        is ConnectorShape, is ImageShape -> Unit
      }
    }
    for (asset in assets.values) bytes += asset.src.length * 2L
    return bytes
  }

  private fun put(record: BoardRecord, revision: Double) {
    when (record) {
      is BoardShape -> {
        assets.remove(record.id)
        shapes[record.id] = PlacedShape(record, revision)
      }
      is BoardAsset -> {
        shapes.remove(record.id)
        assets[record.id] = record
      }
    }
  }

  private companion object {
    val DRAW_ORDER: Comparator<PlacedShape> = Comparator { a, b ->
      val layerA = if (a.shape is HighlightShape) 0 else 1
      val layerB = if (b.shape is HighlightShape) 0 else 1
      when {
        layerA != layerB -> layerA - layerB
        a.shape.z != b.shape.z -> a.shape.z.compareTo(b.shape.z)
        else -> a.shape.id.compareTo(b.shape.id)
      }
    }
  }
}
