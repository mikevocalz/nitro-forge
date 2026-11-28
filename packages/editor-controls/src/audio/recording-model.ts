/**
 * Presentational recording states. The app's recorder (Forge's capture and
 * PCM controllers) owns the real session and maps its phase onto this union;
 * nothing here touches a microphone, file or audio graph.
 */

/** State shown by `RecordingTrack`. One value per phase; no boolean clusters. */
export type RecordingViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "no-input-device" }
  | { readonly kind: "preparing" }
  | { readonly kind: "recording"; readonly durationMs: number }
  | { readonly kind: "interrupted"; readonly durationMs: number; readonly message: string }
  | { readonly kind: "stopping"; readonly durationMs: number }
  | { readonly kind: "saved"; readonly durationMs: number; readonly label?: string }
  | { readonly kind: "error"; readonly message: string };

/** Which callback the primary button calls for a given state. */
export type RecordingAction = "start" | "stop" | "save-interrupted" | "retry" | "open-settings";

/** What `RecordingTrack` renders for a {@linkcode RecordingViewState}. */
export interface RecordingPresentation {
  /** One-line status, also exposed as a polite live region. */
  readonly status: string;
  /** Primary action, or `undefined` while the recorder is busy. */
  readonly action?: { readonly kind: RecordingAction; readonly label: string };
  /** True while the recorder is between states and input is blocked. */
  readonly isBusy: boolean;
  /** True for states that need the user's attention (denied, missing, error). */
  readonly isProblem: boolean;
  /** Elapsed take length to display, or `undefined` when there is no take. */
  readonly durationMs?: number;
}

/** Elapsed time as `m:ss.t`, e.g. 83_450 ms -> `1:23.4`. */
export function formatElapsed(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError("durationMs must be a finite number >= 0");
  }
  const tenths = Math.floor(durationMs / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return minutes + ":" + String(seconds).padStart(2, "0") + "." + (tenths % 10);
}

/** Spoken form of {@linkcode formatElapsed}, e.g. `1 minute 23 seconds`. */
export function spokenElapsed(durationMs: number): string {
  formatElapsed(durationMs);
  const total = Math.floor(durationMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const s = seconds + (seconds === 1 ? " second" : " seconds");
  return minutes ? minutes + (minutes === 1 ? " minute " : " minutes ") + s : s;
}

/**
 * Maps a state to its status text and primary action.
 * @param canOpenSettings Pass true when the app supplied an open-settings handler.
 */
export function presentRecording(state: RecordingViewState, canOpenSettings: boolean): RecordingPresentation {
  switch (state.kind) {
    case "idle":
      return { status: "Microphone ready", action: { kind: "start", label: "Start recording" }, isBusy: false, isProblem: false };
    case "requesting-permission":
      return { status: "Waiting for microphone permission", isBusy: true, isProblem: false };
    case "permission-denied":
      return {
        status: "Microphone access is off. Allow it in Settings to record.",
        action: canOpenSettings
          ? { kind: "open-settings", label: "Open Settings" }
          : { kind: "retry", label: "Ask again" },
        isBusy: false, isProblem: true,
      };
    case "no-input-device":
      return {
        status: "No microphone found. Connect one and try again.",
        action: { kind: "retry", label: "Try again" }, isBusy: false, isProblem: true,
      };
    case "preparing":
      return { status: "Preparing microphone", isBusy: true, isProblem: false };
    case "recording":
      return { status: "Recording", action: { kind: "stop", label: "Stop and save" }, isBusy: false, isProblem: false, durationMs: state.durationMs };
    case "interrupted":
      return {
        status: state.message,
        action: { kind: "save-interrupted", label: "Save what was recorded" },
        isBusy: false, isProblem: true, durationMs: state.durationMs,
      };
    case "stopping":
      return { status: "Saving recording", isBusy: true, isProblem: false, durationMs: state.durationMs };
    case "saved":
      return {
        status: state.label ? "Saved " + state.label : "Recording saved",
        action: { kind: "start", label: "Record again" }, isBusy: false, isProblem: false, durationMs: state.durationMs,
      };
    case "error":
      return { status: state.message, action: { kind: "retry", label: "Try again" }, isBusy: false, isProblem: true };
  }
}
