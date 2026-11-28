/**
 * Presentational playback states for `AudioPreview`. The app's player owns
 * decoding, the audio graph and app-background handling.
 */

/** State shown by `AudioPreview`. */
export type PreviewViewState =
  | { readonly kind: "empty"; readonly message?: string }
  | { readonly kind: "ready"; readonly durationMs: number }
  | { readonly kind: "loading" }
  | { readonly kind: "playing"; readonly durationMs: number; readonly positionMs: number }
  | { readonly kind: "error"; readonly message: string };

/** Primary action for a {@linkcode PreviewViewState}. */
export type PreviewAction = "play" | "stop" | "retry";

/** What `AudioPreview` renders for a {@linkcode PreviewViewState}. */
export interface PreviewPresentation {
  readonly status: string;
  readonly action?: { readonly kind: PreviewAction; readonly label: string };
  readonly isBusy: boolean;
  readonly isProblem: boolean;
  /** Playhead in [0, 1] while playing; `undefined` otherwise. */
  readonly progress?: number;
}

/** Maps a preview state to status text, action and progress. */
export function presentPreview(state: PreviewViewState): PreviewPresentation {
  switch (state.kind) {
    case "empty":
      return { status: state.message ?? "Record a clip to preview it", isBusy: false, isProblem: false };
    case "ready":
      return { status: "Ready to play", action: { kind: "play", label: "Play recording" }, isBusy: false, isProblem: false };
    case "loading":
      return { status: "Loading recording", action: { kind: "stop", label: "Cancel" }, isBusy: true, isProblem: false };
    case "playing": {
      const progress = state.durationMs > 0
        ? Math.min(1, Math.max(0, state.positionMs / state.durationMs)) : 0;
      return { status: "Playing", action: { kind: "stop", label: "Stop" }, isBusy: false, isProblem: false, progress };
    }
    case "error":
      return { status: state.message, action: { kind: "retry", label: "Try again" }, isBusy: false, isProblem: true };
  }
}
