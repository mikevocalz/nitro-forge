package com.margelo.nitro.forgeboard.whiteboard

/** `BoardBoxSelection`: a box around [ids] with resize handles and a rotate knob. */
internal data class OverlayBoxSelection(
  val ids: List<String>,
  /** Axis-aligned page bounds, rotation included. */
  val bounds: BoardRect,
  /** False for a single rotated shape, which shows its rotated frame and no handles. */
  val isResizable: Boolean,
  val isRotatable: Boolean,
) : OverlaySelection
