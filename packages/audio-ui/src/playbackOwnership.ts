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

/** Marks app playback as active until the returned function is called. Idempotent. */
export function claimPlayback(): () => void {
  claims++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims--;
  };
}

/** True while any preview holds a claim. */
export function isPlaybackActive(): boolean {
  return claims > 0;
}
