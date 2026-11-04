import { createStore, type StoreApi } from "zustand/vanilla";
import type { WaveformPeak } from "@nitro-forge/media-ui";

export type RecordingPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "preparing" }
  | { readonly kind: "recording"; readonly durationMs: number }
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
  record(): void;
  /** Must return a URI referencing an actual finalized recording. */
  stop(): Promise<string>;
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
  return [...history.slice(-(limit - 1)), sample];
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

/**
 * One lifecycle owner per editor recording session. No hidden React state,
 * duplicate Rust document, or simulated recording. All actions are single
 * flight and state changes are visible through a vanilla Zustand store.
 */
export class ForgeRecordingController {
  private busy = false;
  private generation = 0;
  private disposed = false;
  private stopped = false;

  constructor(
    private readonly driver: RecordingDriver,
    readonly store: StoreApi<RecordingSnapshot>,
  ) {}

  async start(): Promise<boolean> {
    if (this.disposed) throw new Error("Recorder has been disposed");
    if (this.busy || this.store.getState().phase.kind === "recording") return false;
    this.busy = true;
    const generation = ++this.generation;
    this.stopped = false;
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
      await this.driver.configure();
      if (!this.isCurrent(generation)) return false;
      await this.driver.prepare();
      if (!this.isCurrent(generation)) return false;
      this.driver.record();
      if (!this.isCurrent(generation)) {
        await this.safeStop();
        return false;
      }
      this.store.setState({ phase: { kind: "recording", durationMs: 0 } });
      return true;
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "error", message: errorMessage(error) } });
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
    if (!status.isRecording) return;
    const durationMs = Number.isFinite(status.durationMillis)
      ? Math.max(0, Math.round(status.durationMillis))
      : state.phase.durationMs;
    const levelHistory = status.metering === undefined || !Number.isFinite(status.metering)
      ? state.levelHistory
      : pushMeterLevel(state.levelHistory, status.metering);
    this.store.setState({ phase: { kind: "recording", durationMs }, levelHistory });
  }

  async stop(): Promise<string> {
    if (this.disposed) throw new Error("Recorder has been disposed");
    const state = this.store.getState();
    if (this.busy || state.phase.kind !== "recording") {
      throw new Error("Recorder is not recording");
    }
    this.busy = true;
    const generation = ++this.generation;
    const durationMs = state.phase.durationMs;
    this.store.setState({ phase: { kind: "stopping", durationMs } });
    try {
      const uri = await this.driver.stop();
      this.stopped = true;
      if (!uri || typeof uri !== "string") throw new Error("Native recorder did not return a file URI");
      if (this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "saved", uri, durationMs } });
      }
      return uri;
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.store.setState({ phase: { kind: "error", message: errorMessage(error) } });
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    if (!this.stopped && ["recording", "error"].includes(this.store.getState().phase.kind)) {
      await this.safeStop();
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private async safeStop(): Promise<void> {
    if (this.stopped) return;
    try { await this.driver.stop(); }
    catch { /* Some native recorders are already stopped or invalidated. */ }
    finally { this.stopped = true; }
  }
}
