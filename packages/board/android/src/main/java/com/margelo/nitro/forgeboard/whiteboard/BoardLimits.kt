package com.margelo.nitro.forgeboard.whiteboard

/**
 * Size limits on the renderer's wire JSON, enforced by [BoardJsonParser]
 * on the JS thread before anything reaches the render thread. Breaking one
 * rejects the call, except [maxExtent], which clamps.
 */
internal data class BoardLimits(
  /** Characters in one snapshot or diff. */
  val maxDocumentJsonChars: Int = 32 * 1024 * 1024,
  /** Characters in one overlay. */
  val maxOverlayJsonChars: Int = 4 * 1024 * 1024,
  /** Records in one snapshot, or added + updated + removed in one diff. */
  val maxRecords: Int = 50_000,
  /** Numbers in one `pts`, `inkOutline` or eraser trail array. */
  val maxArrayNumbers: Int = 200_000,
  /** Items in one overlay array (marquees, laser strokes and their points, trails, ids). */
  val maxArrayItems: Int = 50_000,
  /** Characters in one text, label or string id. */
  val maxTextChars: Int = 32_768,
  /** Board units a shape's `w` or `h` is clamped to. */
  val maxExtent: Double = 1_000_000.0,
)
