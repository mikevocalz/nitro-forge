import { createStore, type StoreApi } from "zustand/vanilla";
import type { WaveformPeak } from "@nitro-forge/media-ui";

export type RecordingPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "preparing" }
  | { readonly kind: "recording"; readonly durationMs: number }
  /**
   * Capture stopped without the user asking. The take is never discarded:
   * stop() saves what was recorded. {@linkcode InterruptionCause} says
   * whether the file is still open and whether capture can resume into it.
   */
  | {
      readonly kind: "interrupted";
      readonly durationMs: number;
      readonly message: string;
      readonly cause: InterruptionCause;
    }
  | { readonly kind: "stopping"; readonly durationMs: number }
  | { readonly kind: "saved"; readonly uri: string; readonly durationMs: number }
  | { readonly kind: "error"; readonly message: string };

/**
 * Why a take is in the "interrupted" phase.
 * - "session": the OS interrupted the audio session (call, Siri, another
 *   app). The recorder is paused with its file open; when the OS ends the
 *   interruption with shouldResume, capture continues into the same file.
 * - "input-lost": the input device went away (headset unplugged). The
 *   recorder is paused with its file open so nothing is captured from a
 *   different microphone; the user saves what was recorded.
 * - "ended": native capture is over and the file is (or is being)
 *   finalized. Only saving remains.
 */
export type InterruptionCause = "session" | "input-lost" | "ended";

/**
 * Result of {@linkcode ForgeRecordingController.pauseForInterruption} and
 * {@linkcode ForgeRecordingController.resumeAfterInterruption}.
 * - "done": the native recorder paused or is capturing again.
 * - "skipped": the take was not in a state the step applies to, or another
 *   controller action was in flight; nothing changed.
 * - "failed": the native call threw or did not take effect; the take is
 *   "interrupted" and saveable, and the caller should finalize it.
 */
export type InterruptionStep =
  | { readonly kind: "done" }
  | { readonly kind: "skipped" }
  | { readonly kind: "failed"; readonly reason: string };

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
  /** Pause capture without closing the file. */
  pause(): Promise<void>;
  /** Continue capture into the file opened by record(). */
  resume(): Promise<void>;
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

const DONE: InterruptionStep = { kind: "done" };
const SKIPPED: InterruptionStep = { kind: "skipped" };

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
  private pendingAbort: Promise<void> = Promise.resolve();

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
      this.pendingAbort = this.abort("Audio services reset; retry recording.");
      return;
    }
    if (!status.isRecording) {
      // Only a recorder that was seen running can be "interrupted"; the first
      // poll may land before the native recorder reports its started state.
      if (this.confirmedRecording) this.reportInterrupted();
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

  /**
   * Native capture ended without the user asking (system stop, app left the
   * foreground, or an interruption that may not resume). Moves a recording
   * or paused take to cause "ended"; the caller finalizes the file.
   */
  reportInterrupted(message = INTERRUPTED_MESSAGE): void {
    if (this.disposed || this.busy) return;
    const phase = this.store.getState().phase;
    if (phase.kind !== "recording" && !(phase.kind === "interrupted" && phase.cause !== "ended")) return;
    this.store.setState({
      phase: { kind: "interrupted", durationMs: phase.durationMs, message, cause: "ended" },
    });
  }

  /**
   * Pause a live take with its file open: an OS session interruption
   * ("session") or a lost input device ("input-lost"). The phase moves to
   * "interrupted" before the native call, so the take stays saveable even
   * when pausing fails; the caller then finalizes it.
   */
  async pauseForInterruption(cause: "session" | "input-lost", message: string): Promise<InterruptionStep> {
    if (this.disposed || this.busy) return SKIPPED;
    const phase = this.store.getState().phase;
    if (phase.kind !== "recording") return SKIPPED;
    this.busy = true;
    const generation = ++this.generation;
    this.store.setState({ phase: { kind: "interrupted", durationMs: phase.durationMs, message, cause } });
    try {
      await this.driver.pause();
      return this.isCurrent(generation) ? DONE : SKIPPED;
    } catch (error) {
      return { kind: "failed", reason: "Pausing the recorder failed: " + errorMessage(error) };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Continue a take paused by an OS interruption ("session" cause) into the
   * same file. Audio API's resume() returns without error when it cannot
   * resume (no stream, already finalized), so the result is confirmed with
   * getStatus() before the phase returns to "recording". On failure the take
   * stays "interrupted" and saveable; the caller finalizes it.
   */
  async resumeAfterInterruption(): Promise<InterruptionStep> {
    if (this.disposed || this.busy) return SKIPPED;
    const phase = this.store.getState().phase;
    if (phase.kind !== "interrupted" || phase.cause !== "session") return SKIPPED;
    this.busy = true;
    const generation = ++this.generation;
    let failure: string | null = null;
    try {
      await this.driver.resume();
      if (!this.driver.getStatus().isRecording) failure = "The recorder did not restart after the interruption";
    } catch (error) {
      failure = "Resuming the recorder failed: " + errorMessage(error);
    } finally {
      this.busy = false;
    }
    if (!this.isCurrent(generation)) return SKIPPED;
    if (failure !== null) return { kind: "failed", reason: failure };
    this.store.setState({ phase: { kind: "recording", durationMs: phase.durationMs } });
    return DONE;
  }

  /** The native status read threw while recording: show it, don't freeze. */
  reportStatusError(error: unknown): Promise<void> {
    this.pendingAbort = this.abort(errorMessage(error));
    return this.pendingAbort;
  }

  /**
   * A live capture failed (backend error, unreadable stream). Stop native
   * capture, restore the audio session and show the failure. The controller
   * stays usable: start() can record again.
   */
  async abort(message: string): Promise<void> {
    if (this.disposed || this.busy) return;
    const kind = this.store.getState().phase.kind;
    if (kind !== "recording" && kind !== "interrupted") return;
    this.busy = true;
    const generation = ++this.generation;
    this.store.setState({ phase: { kind: "error", message } });
    try {
      const failures = await this.teardownErrors();
      if (failures.length > 0 && this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "error", message: [message, ...failures].join("; ") } });
      }
    } finally {
      this.busy = false;
    }
  }

  /** Resolves once an abort started from a synchronous callback finishes. */
  settled(): Promise<void> {
    return this.pendingAbort;
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
