import type { PlaybackSession } from "@nyc-tron/platform-services/playback";

/** Actual NYC-Tron session owners, held only while their preview effect is mounted. */
const sessions = new Set<PlaybackSession>();
const idleWaiters = new Set<() => void>();

export function hasPlaybackIntent(): boolean {
  return [...sessions].some(session => session.store.getState().intent === "playing");
}

function notifyIdle(): void {
  if (hasPlaybackIntent()) return;
  const waiters = [...idleWaiters];
  idleWaiters.clear();
  for (const waiter of waiters) waiter();
}

/** The session's Zustand lifecycle store is the source of playback ownership. */
export function registerPlaybackSession(session: PlaybackSession): () => void {
  sessions.add(session);
  // NYC-Tron updates its store before calling onAction. Wait until that
  // callback has stopped the graph before allowing capture to release focus.
  const unsubscribe = session.store.subscribe(() => queueMicrotask(notifyIdle));
  return () => {
    unsubscribe();
    sessions.delete(session);
    notifyIdle();
  };
}

export function whenPlaybackIdle(callback: () => void): void {
  if (hasPlaybackIntent()) idleWaiters.add(callback);
  else callback();
}
