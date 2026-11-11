package com.margelo.nitro.forgeboard.whiteboard

/** One QuickDraw store record the renderer understands: a shape or an image asset. */
internal sealed interface BoardRecord {
  val id: String
}
