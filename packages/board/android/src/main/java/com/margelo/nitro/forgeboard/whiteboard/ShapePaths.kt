package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Path

/** Cached local-space paths of one shape at one revision. [head] is the arrow chevron. */
internal class ShapePaths(val revision: Double, val body: Path, val head: Path?)
