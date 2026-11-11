package com.margelo.nitro.forgeboard.whiteboard

/** `BoardLineSelection`: endpoint and bend handles of one arrow or line, in page coordinates. */
internal data class OverlayLineSelection(
  val id: String,
  val start: BoardPoint,
  val end: BoardPoint,
  val bend: BoardPoint,
) : OverlaySelection
