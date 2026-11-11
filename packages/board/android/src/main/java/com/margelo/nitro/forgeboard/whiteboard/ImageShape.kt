package com.margelo.nitro.forgeboard.whiteboard

/** An `image` shape that draws the asset [assetId] into a `w` x `h` local box. */
internal class ImageShape(
  override val id: String,
  override val x: Double,
  override val y: Double,
  override val rot: Double,
  override val z: Double,
  val w: Double,
  val h: Double,
  val assetId: String,
) : BoardShape
