package com.margelo.nitro.forgeboard.whiteboard

/** A QuickDraw `asset` record. [src] is a `data:` URL, a `file://` URL or an absolute path. */
internal class BoardAsset(
  override val id: String,
  val src: String,
) : BoardRecord
