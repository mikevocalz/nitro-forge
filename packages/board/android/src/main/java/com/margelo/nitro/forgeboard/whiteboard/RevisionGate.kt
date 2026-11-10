package com.margelo.nitro.forgeboard.whiteboard

/**
 * Accepts strictly increasing revisions. [admit] runs its action under the
 * gate's lock, so actions run (and post their work) in revision order even
 * when several JS runtimes call the renderer.
 */
internal class RevisionGate {
  private var lastAccepted = Double.NEGATIVE_INFINITY

  /**
   * Runs [action] if [revision] is finite and newer than every accepted one.
   * @throws IllegalArgumentException for a non-finite or stale revision; [action] does not run.
   */
  @Synchronized
  fun admit(revision: Double, action: () -> Unit) {
    require(revision.isFinite()) { "Revision must be a finite number, got $revision" }
    require(revision > lastAccepted) {
      "Revision $revision is not newer than the last accepted revision $lastAccepted"
    }
    action()
    lastAccepted = revision
  }
}
