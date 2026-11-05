import type { WhiteboardRenderer } from "./WhiteboardRenderer.nitro";

/**
 * Ends one listener registration. `remove` is idempotent; an event already
 * being delivered when it is called may still arrive.
 *
 * @see {@linkcode WhiteboardRenderer.addOnStateChangedListener}
 */
export interface ListenerSubscription {
  /** Stops future events for this listener. */
  remove: () => void;
}
