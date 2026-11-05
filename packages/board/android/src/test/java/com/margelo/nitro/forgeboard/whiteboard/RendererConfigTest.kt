package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.forgeboard.BoardCamera
import com.margelo.nitro.forgeboard.WhiteboardRendererOptions
import org.junit.Assert.assertEquals
import org.junit.Test

class RendererConfigTest {
  private fun options(
    surfaceId: Double = 7.0,
    widthPx: Double = 2016.0,
    heightPx: Double = 1260.0,
    pixelRatio: Double = 2.0,
    cornerRadiusPx: Double = 64.0,
    backgroundColor: String = "#FFFFFF",
  ) = WhiteboardRendererOptions(surfaceId, widthPx, heightPx, pixelRatio, cornerRadiusPx, backgroundColor)

  @Test
  fun convertsValidOptions() {
    val config = options(backgroundColor = "#fbf9f480").toRendererConfig()
    assertEquals(7, config.surfaceId)
    assertEquals(1008.0, config.viewWidth, 0.0)
    assertEquals(0x80FBF9F4.toInt(), config.backgroundArgb)
  }

  @Test
  fun rejectsInvalidOptions() {
    val invalid = listOf(
      options(surfaceId = 1.5),
      options(widthPx = 0.0),
      options(heightPx = Double.NaN),
      options(pixelRatio = 0.0),
      options(cornerRadiusPx = -1.0),
      options(backgroundColor = "white"),
      options(backgroundColor = "#FFF"),
    )
    for (value in invalid) expectThrows<IllegalArgumentException>(value.toString()) { value.toRendererConfig() }
  }

  @Test
  fun rejectsADegenerateCamera() {
    expectThrows<IllegalArgumentException> { BoardCamera(0.0, 0.0, 0.0).requireValid() }
    expectThrows<IllegalArgumentException> { BoardCamera(Double.POSITIVE_INFINITY, 0.0, 1.0).requireValid() }
    assertEquals(BoardCamera(1.0, 2.0, 3.0), BoardCamera(1.0, 2.0, 3.0).requireValid())
  }
}
