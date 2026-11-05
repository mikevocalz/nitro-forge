import type { PreviewViewState } from "@nyc-tron/ui/components/forge/audio/preview-model";
import type { PlaybackSnapshot } from "./audioPlayback";

/**
 * Maps Forge's preview player snapshot onto NYC-Tron's AudioPreview state.
 * `uri` is the saved take (null before one exists); `recordedSeconds` is
 * its length from the recorder, shown before the clip is decoded.
 */
export function toPreviewViewState(
  snapshot: PlaybackSnapshot,
  uri: string | null,
  recordedSeconds: number,
  positionSeconds: number,
): PreviewViewState {
  if (snapshot.phase === "error") return { kind: "error", message: snapshot.message };
  if (!uri) return { kind: "empty", message: "Record a clip to preview" };
  if (snapshot.phase === "loading") return { kind: "loading" };
  if (snapshot.phase === "playing") {
    const durationMs = toMs(snapshot.duration);
    return { kind: "playing", durationMs, positionMs: Math.min(durationMs, toMs(positionSeconds)) };
  }
  return { kind: "ready", durationMs: toMs(recordedSeconds) };
}

function toMs(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}
