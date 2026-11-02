package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Path

/**
 * Paths of settled shapes keyed by record id and revision. A record that has
 * not changed keeps its revision and reuses its paths; live strokes
 * (`done == false`) are rebuilt every frame and never cached. Render thread only.
 */
internal class ShapePathCache {
  private val entries = HashMap<String, ShapePaths>()

  /** @return paths for [placed], or null for shapes drawn without paths (text, note, image). */
  fun pathsFor(placed: PlacedShape): ShapePaths? {
    val shape = placed.shape
    entries[shape.id]?.let { if (it.revision == placed.revision) return it }
    val paths = build(shape, placed.revision) ?: return null
    val cacheable = shape !is DrawShape || shape.isDone
    if (cacheable) entries[shape.id] = paths else entries.remove(shape.id)
    return paths
  }

  /** Drops entries for ids no longer in the document. */
  fun retainOnly(ids: Set<String>) {
    entries.keys.retainAll(ids)
  }

  fun clear() {
    entries.clear()
  }

  private fun build(shape: BoardShape, revision: Double): ShapePaths? {
    val body = Path()
    val sink = AndroidPathSink(body)
    var head: Path? = null
    when (shape) {
      is DrawShape -> {
        val outline = shape.inkOutline
        if (outline != null) ShapeGeometry.inkOutline(sink, outline) else ShapeGeometry.centerline(sink, shape.points)
      }
      is HighlightShape -> ShapeGeometry.centerline(sink, shape.points)
      is GeoShape -> ShapeGeometry.geoOutline(sink, shape)
      is ConnectorShape -> {
        ShapeGeometry.connectorBody(sink, shape)
        if (shape.hasArrowHead) {
          val pts = ShapeGeometry.arrowHead(shape)
          head = Path().apply {
            moveTo(pts[0].toFloat(), pts[1].toFloat())
            lineTo(pts[2].toFloat(), pts[3].toFloat())
            lineTo(pts[4].toFloat(), pts[5].toFloat())
          }
        }
      }
      is TextShape, is NoteShape, is ImageShape -> return null
    }
    return ShapePaths(revision, body, head)
  }
}
