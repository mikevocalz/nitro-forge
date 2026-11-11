package com.margelo.nitro.forgeboard.whiteboard

/** Everything drawn over the document that is not part of it. Immutable. */
internal class BoardOverlayState(
  val selection: OverlaySelection?,
  /** Page-space marquee rectangles. */
  val marquees: List<BoardRect>,
  val laserStrokes: List<OverlayLaserStroke>,
  /** Flat page `[x, y, ...]` per erasing pointer. */
  val eraserTrails: List<DoubleArray>,
  /** Shapes an in-progress erase will delete; drawn ghosted. */
  val pendingEraseIds: Set<String>,
) {
  companion object {
    val EMPTY = BoardOverlayState(null, emptyList(), emptyList(), emptyList(), emptySet())
  }
}
