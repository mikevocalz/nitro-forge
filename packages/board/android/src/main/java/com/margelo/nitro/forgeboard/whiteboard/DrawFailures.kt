package com.margelo.nitro.forgeboard.whiteboard

/**
 * Which failures while drawing a frame the render thread survives. A
 * recovered failure marks the renderer `lost` (JS resends a snapshot)
 * instead of letting the exception end the HandlerThread and the process.
 */
internal object DrawFailures {
  /**
   * True for exceptions and for errors that leave the VM usable: an
   * OutOfMemoryError from a bitmap, a StackOverflowError from a deep shape,
   * a LinkageError or AssertionError from the painter. False for
   * InternalError and UnknownError, after which the VM is not trustworthy.
   */
  fun isRecoverable(failure: Throwable): Boolean = when (failure) {
    is OutOfMemoryError, is StackOverflowError -> true
    is VirtualMachineError -> false
    else -> true
  }
}
