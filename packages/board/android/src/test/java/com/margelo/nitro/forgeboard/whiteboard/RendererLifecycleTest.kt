package com.margelo.nitro.forgeboard.whiteboard

import com.margelo.nitro.forgeboard.WhiteboardRendererState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RendererLifecycleTest {
  @Test
  fun followsTheSurfaceThroughRevokeLossAndReattach() {
    val lifecycle = RendererLifecycle()
    assertEquals(WhiteboardRendererState.WAITING_FOR_SURFACE, lifecycle.onSubscribed())
    assertEquals(WhiteboardRendererState.ACTIVE, lifecycle.onSurfaceProvided())
    assertNull("providing again while active changes nothing", lifecycle.onSurfaceProvided())
    assertEquals(WhiteboardRendererState.SUSPENDED, lifecycle.onSurfaceRevoked())
    assertNull("a suspended renderer has nothing to lose", lifecycle.onDrawFailed())
    assertEquals(WhiteboardRendererState.ACTIVE, lifecycle.onSurfaceProvided())
    assertEquals(WhiteboardRendererState.LOST, lifecycle.onDrawFailed())
    assertEquals(WhiteboardRendererState.ACTIVE, lifecycle.onSurfaceProvided())
  }

  @Test
  fun disposedIsTerminal() {
    val lifecycle = RendererLifecycle()
    lifecycle.onSubscribed()
    assertEquals(WhiteboardRendererState.DISPOSED, lifecycle.onDisposed())
    assertNull(lifecycle.onSurfaceProvided())
    assertNull(lifecycle.onSurfaceRevoked())
    assertNull(lifecycle.onDrawFailed())
    assertNull(lifecycle.onDisposed())
    assertEquals(WhiteboardRendererState.DISPOSED, lifecycle.state)
  }

  @Test
  fun aRevokeBeforeAnySurfaceIsIgnored() {
    val lifecycle = RendererLifecycle()
    lifecycle.onSubscribed()
    assertNull(lifecycle.onSurfaceRevoked())
    assertEquals(WhiteboardRendererState.WAITING_FOR_SURFACE, lifecycle.state)
  }
}
