package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.forgeboard.BoardCamera

/** @throws IllegalArgumentException unless every field is finite and `z > 0`. */
internal fun BoardCamera.requireValid(): BoardCamera {
  require(x.isFinite() && y.isFinite() && z.isFinite() && z > 0) {
    "camera must have finite x, y, z and z > 0, got ($x, $y, $z)"
  }
  return this
}
