/**
 * Whether this app is playing audio right now (a Forge preview is loading or
 * playing). The capture session reads it on release to decide between
 * deactivating the session and handing it back to playback.
 *
 * This is a flag, not a playback session manager. NYC-Tron's platform PR
 * (NYC-Tron-UI #45) adds the generic playback-session module; once it ships,
 * previews register there and this file goes away.
 */
let claims = 0;
let idleWaiters: (() => void)[] = [];

/** Marks app playback as active until the returned function is called. Idempotent. */
export function claimPlayback(): () => void {
  claims++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims--;
    if (claims > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const waiter of waiters) waiter();
  };
}

/** Runs `callback` once no preview holds a claim: now, or when the last claim is released. */
export function whenPlaybackIdle(callback: () => void): void {
  if (claims === 0) callback();
  else idleWaiters.push(callback);
}

/** True while any preview holds a claim. */
export function isPlaybackActive(): boolean {
  return claims > 0;
}
