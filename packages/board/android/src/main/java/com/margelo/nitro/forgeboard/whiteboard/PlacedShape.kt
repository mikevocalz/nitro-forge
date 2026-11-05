package com.margelo.nitro.forgeboard.whiteboard

/** A shape plus the document revision that last wrote it; the path cache keys on both. */
internal class PlacedShape(val shape: BoardShape, val revision: Double)
