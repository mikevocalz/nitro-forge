import type { RecordingViewState } from "@nyc-tron/ui/components/forge/audio/recording-model";
import type { WaveformPeak } from "@nitro-forge/media-ui";
import type { RecordingPhase } from "./recording";

/**
 * Maps the controller's phase onto NYC-Tron's presentational recording state.
 * The controller stays the only owner of the native session; this is a pure
 * projection, so the view never sees a file URI it does not need.
 */
export function toRecordingViewState(phase: RecordingPhase): RecordingViewState {
  switch (phase.kind) {
    case "idle":
    case "requesting-permission":
    case "permission-denied":
    case "preparing":
      return { kind: phase.kind };
    case "recording":
    case "stopping":
      return { kind: phase.kind, durationMs: phase.durationMs };
    case "interrupted":
      return { kind: "interrupted", durationMs: phase.durationMs, message: phase.message };
    case "saved":
      return { kind: "saved", durationMs: phase.durationMs, label: fileLabel(phase.uri) };
    case "error":
      return { kind: "error", message: phase.message };
  }
}

/** File name of a saved recording URI, for the "Saved <name>" status. */
export function fileLabel(uri: string): string {
  const name = uri.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(name) || "recording";
  } catch {
    return name || "recording";
  }
}

/**
 * Linear input level in [0, 1] from the newest measured peak, or undefined
 * when nothing has been measured yet (the meter stays hidden rather than
 * showing an invented zero).
 */
export function inputLevel(history: readonly WaveformPeak[]): number | undefined {
  const last = history[history.length - 1];
  if (!last) return undefined;
  const level = Math.max(Math.abs(last.min), Math.abs(last.max));
  return Number.isFinite(level) ? Math.min(1, level) : undefined;
}
