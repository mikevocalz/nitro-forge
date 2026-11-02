package com.margelo.nitro.forgeboard.whiteboard

/**
 * Wrapped text for a text shape, a note or a geo label, with the box
 * measurements `shapes.js` derives from it.
 */
internal class TextBlockLayout(
  val lines: List<TextLine>,
  val font: BoardFont,
  val fontSize: Double,
  val lineHeight: Double,
  /** Text shape width; 0 for notes and labels. */
  val width: Double,
  /** Text shape height; 0 for notes and labels. */
  val height: Double,
  /** `lines.size * lineHeight`. */
  val textHeight: Double,
  /** Note paper height; 0 for text shapes and labels. */
  val boxHeight: Double,
)
