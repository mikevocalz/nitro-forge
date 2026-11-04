import { createStore, type StoreApi } from "zustand/vanilla";
import type { WaveformPeak } from "@nitro-forge/media-ui";

export type RecordingPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "preparing" }
  | { readonly kind: "recording"; readonly durationMs: number }
  /**
   * The OS stopped the native recorder (phone call, route loss, another app
   * taking the session). The partial file can still be finalized with stop().
   */
  | { readonly kind: "interrupted"; readonly durationMs: number; readonly message: string }
  | { readonly kind: "stopping"; readonly durationMs: number }
  | { readonly kind: "saved"; readonly uri: string; readonly durationMs: number }
  | { readonly kind: "error"; readonly message: string };

export interface RecordingSnapshot {
  readonly phase: RecordingPhase;
  /**
   * Coarse microphone meter history (approximate dBFS levels), not an audio
   * waveform or PCM peak pyramid. Capture/encoding remain on native threads.
   */
  readonly levelHistory: readonly WaveformPeak[];
}

export interface RecordingStatus {
  readonly isRecording: boolean;
  readonly durationMillis: number;
  readonly mediaServicesDidReset?: boolean;
  readonly metering?: number;
}

export interface RecordingDriver {
  /** Prompt only in response to an actual user start action. */
  requestPermission(): Promise<boolean>;
  configure(): Promise<void>;
  prepare(): Promise<void>;
  record(): void | Promise<void>;
  /** Must return a URI referencing an actual finalized recording. */
  stop(): Promise<string>;
  /**
   * Undo configure(): hand the audio session back to playback. Called once
   * after every configure(), on stop, failed start, detach and dispose.
   */
  release(): Promise<void>;
  getStatus(): RecordingStatus;
}

export const MAX_METER_HISTORY = 160;

/**
 * A dBFS level sample is a coarse amplitude indicator, NOT a waveform sample.
 * Invalid, clipped or unavailable readings never generate made-up peaks.
 */
export function dbfsToPeak(dbfs: number): WaveformPeak {
  if (!Number.isFinite(dbfs)) {
    throw new RangeError("Meter sample must be a finite dBFS value");
  }
  const linear = Math.max(0, Math.min(1, Math.pow(10, dbfs / 20)));
  return { min: -linear, max: linear };
}

export function pushMeterLevel(
  history: readonly WaveformPeak[],
  dbfs: number,
  limit = MAX_METER_HISTORY,
): WaveformPeak[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096) {
    throw new RangeError("Meter history limit must be 1..4096");
  }
  const sample = dbfsToPeak(dbfs);
  return limit === 1 ? [sample] : [...history.slice(1 - limit), sample];
}

export function createRecordingStore(): StoreApi<RecordingSnapshot> {
  return createStore<RecordingSnapshot>(() => ({
    phase: { kind: "idle" },
    levelHistory: [],
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Recording failed";
}

export const INTERRUPTED_MESSAGE =
  "Recording stopped by the system (call, route change or another app).";

/**
 * One lifecycle owner per editor recording session. No hidden React state,
 * duplicate Rust document, or simulated recording. All actions are single
 * flight and state changes are visible through a vanilla Zustand store.
 *
 * Host lifecycle: attach()/detach() pair with a React effect and can repeat
 * (StrictMode double-invokes effects, Fast Refresh re-runs them). detach()
 * stops any live capture and releases the audio session but leaves the
 * controller reusable. dispose() is the permanent end.
 */
export class ForgeRecordingController {
  private busy = false;
  private generation = 0;
  private disposed = false;
  private attached = true;
  private stopped = true;
  private sessionActive = false;
  private confirmedRecording = false;

  constructor(
    private readonly driver: RecordingDriver,
    readonly store: StoreApi<RecordingSnapshot>,
  ) {}

  attach(): void {
    if (this.disposed) throw new Error("Recorder has been disposed");
    this.attached = true;
  }

  /** Effect cleanup. Reversible with attach(). Failures land in the store. */
  async detach(): Promise<void> {
    if (!this.attached) return;
    this.attached = false;
    ++this.generation;
    await this.teardown();
  }

  async start(): Promise<boolean> {
    this.assertUsable();
    if (this.busy || this.store.getState().phase.kind === "recording") return false;
    this.busy = true;
    const generation = ++this.generation;
    this.confirmedRecording = false;
    try {
      this.store.setState({ phase: { kind: "requesting-permission" }, levelHistory: [] });
      if (!(await this.driver.requestPermission())) {
        if (this.isCurrent(generation)) {
          this.store.setState({ phase: { kind: "permission-denied" } });
        }
        return false;
      }
      if (!this.isCurrent(generation)) return false;
      this.store.setState({ phase: { kind: "preparing" } });
      this.sessionActive = true;
      await this.driver.configure();
      if (!this.isCurrent(generation)) return await this.abandon();
      await this.driver.prepare();
      if (!this.isCurrent(generation)) return await this.abandon();
      this.stopped = false;
      await this.driver.record();
      if (!this.isCurrent(generation)) return await this.abandon();
      this.store.setState({ phase: { kind: "recording", durationMs: 0 } });
      return true;
    } catch (error) {
      const failures = [errorMessage(error), ...(await this.teardownErrors())];
      if (this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "error", message: failures.join("; ") } });
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  observe(status: RecordingStatus): void {
    if (this.disposed || this.busy) return;
    const state = this.store.getState();
    if (state.phase.kind !== "recording") return;
    if (status.mediaServicesDidReset) {
      this.store.setState({
        phase: { kind: "error", message: "Audio services reset; stop and retry recording." },
      });
      return;
    }
    if (!status.isRecording) {
      // Only a recorder that was seen running can be "interrupted"; the first
      // poll may land before the native recorder reports its started state.
      if (this.confirmedRecording) {
        this.store.setState({
          phase: {
            kind: "interrupted",
            durationMs: state.phase.durationMs,
            message: INTERRUPTED_MESSAGE,
          },
        });
      }
      return;
    }
    this.confirmedRecording = true;
    const durationMs = Number.isFinite(status.durationMillis)
      ? Math.max(0, Math.round(status.durationMillis))
      : state.phase.durationMs;
    const levelHistory = status.metering === undefined || !Number.isFinite(status.metering)
      ? state.levelHistory
      : pushMeterLevel(state.levelHistory, status.metering);
    this.store.setState({ phase: { kind: "recording", durationMs }, levelHistory });
  }

  /** The native status read threw while recording: show it, don't freeze. */
  reportStatusError(error: unknown): void {
    if (this.disposed || this.busy) return;
    if (this.store.getState().phase.kind !== "recording") return;
    this.store.setState({ phase: { kind: "error", message: errorMessage(error) } });
  }

  async stop(): Promise<string> {
    this.assertUsable();
    const state = this.store.getState();
    if (this.busy || (state.phase.kind !== "recording" && state.phase.kind !== "interrupted")) {
      throw new Error("Recorder is not recording");
    }
    this.busy = true;
    const generation = ++this.generation;
    const durationMs = state.phase.durationMs;
    this.store.setState({ phase: { kind: "stopping", durationMs } });
    try {
      let uri: string;
      try {
        uri = await this.driver.stop();
      } finally {
        this.stopped = true;
      }
      await this.releaseSession();
      if (!uri || typeof uri !== "string") throw new Error("Native recorder did not return a file URI");
      if (this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "saved", uri, durationMs } });
      }
      return uri;
    } catch (error) {
      const failures = [errorMessage(error), ...(await this.teardownErrors())];
      if (this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "error", message: failures.join("; ") } });
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.attached = false;
    this.disposed = true;
    ++this.generation;
    await this.teardown();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Recorder has been disposed");
    if (!this.attached) throw new Error("Recorder is detached from its host");
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.attached && this.generation === generation;
  }

  /** A start() overtaken by detach/dispose undoes its own native work. */
  private async abandon(): Promise<false> {
    const failures = await this.teardownErrors();
    if (failures.length > 0) {
      this.store.setState({ phase: { kind: "error", message: failures.join("; ") } });
    }
    return false;
  }

  private async teardown(): Promise<void> {
    const failures = await this.teardownErrors();
    if (failures.length > 0) {
      this.store.setState({ phase: { kind: "error", message: failures.join("; ") } });
    } else if (["recording", "interrupted", "stopping", "preparing", "requesting-permission"]
      .includes(this.store.getState().phase.kind)) {
      this.store.setState({ phase: { kind: "idle" } });
    }
  }

  /** Stop native capture and release the session; collect, never swallow. */
  private async teardownErrors(): Promise<string[]> {
    const failures: string[] = [];
    if (!this.stopped) {
      this.stopped = true;
      try { await this.driver.stop(); }
      catch (error) { failures.push("Stopping recorder failed: " + errorMessage(error)); }
    }
    try { await this.releaseSession(); }
    catch (error) { failures.push("Restoring audio session failed: " + errorMessage(error)); }
    return failures;
  }

  private async releaseSession(): Promise<void> {
    if (!this.sessionActive) return;
    this.sessionActive = false;
    await this.driver.release();
  }
}
