import type { StoreApi } from "zustand/vanilla";
import type { WaveformPeak } from "@nitro-forge/media-ui";
import { MAX_METER_HISTORY, type RecordingSnapshot } from "./recording";
import { WaveformPeakAccumulator, type PcmEncoding } from "./pcmPeaks";
import { planarPeak } from "./audioApiContracts";

/** Column count of the full-recording waveform shown after saving. */
export const SOURCE_COLUMNS = 512;

export interface PcmBuffer {
  readonly data: ArrayBuffer;
  readonly channels: number;
  readonly sampleRate: number;
  readonly timestamp: number;
}

/**
 * Accumulates peaks only for buffers that land in the WAV file. The caller
 * opens the window when the recorder starts writing the file and closes it
 * when the file is finalized. Buffers outside it are not in the file and are
 * ignored, so peak positions match file time.
 */
export class PcmCaptureSession {
  private readonly accumulator = new WaveformPeakAccumulator(4096);
  private capturing = false;
  private dropped = 0;
  private sampleRate = 0;

  constructor(
    private readonly store: StoreApi<RecordingSnapshot>,
    private readonly encoding: PcmEncoding = "int16",
    /** Called once for an unreadable stream; must stop native capture. */
    private readonly onFatal: (message: string) => void = (message) => {
      store.setState({ phase: { kind: "error", message } });
    },
  ) {}

  get frames(): number { return this.accumulator.frames; }
  get droppedBuffers(): number { return this.dropped; }

  reset(): void {
    this.accumulator.reset();
    this.capturing = false;
    this.dropped = 0;
    this.sampleRate = 0;
  }

  openFileWindow(): void { this.capturing = true; }
  closeFileWindow(): void { this.capturing = false; }

  /** Interleaved PCM bytes (int16 or float32). */
  onBuffer(buffer: PcmBuffer): void {
    if (!this.capturing) return;
    let peak: WaveformPeak | undefined;
    try {
      peak = this.accumulator.appendPcm(buffer.data, buffer.channels, this.encoding).peak;
    } catch (error) {
      const bytesPerFrame = (this.encoding === "int16" ? 2 : 4) * buffer.channels;
      const frames = Number.isInteger(buffer.channels) && buffer.channels > 0
        ? Math.floor(buffer.data.byteLength / bytesPerFrame)
        : 0;
      if (!this.dropOrFail(frames, error)) return;
    }
    this.publish(peak, buffer.sampleRate);
  }

  /**
   * Planar Float32 channels, as delivered by Audio API's
   * AudioRecorder.onAudioReady. Same window, gap and failure rules as
   * onBuffer().
   */
  onPlanarBuffer(channels: readonly Float32Array[], numFrames: number, sampleRate: number): void {
    if (!this.capturing) return;
    let peak: WaveformPeak | undefined;
    try {
      peak = planarPeak(channels, numFrames);
      this.accumulator.append(peak, numFrames);
    } catch (error) {
      peak = undefined;
      if (!this.dropOrFail(Number.isSafeInteger(numFrames) ? numFrames : 0, error)) return;
    }
    this.publish(peak, sampleRate);
  }

  /** Returns false after a fatal failure; otherwise the gap is recorded. */
  private dropOrFail(frames: number, error: unknown): boolean {
    if (frames < 1) {
      this.fail("Unreadable PCM buffer from the native stream: " +
        (error instanceof Error ? error.message : String(error)));
      return false;
    }
    // Keep the timeline aligned with the file; the gap stays visible.
    this.dropped++;
    this.accumulator.skip(frames);
    return true;
  }

  private publish(peak: WaveformPeak | undefined, sampleRate: number): void {
    if (Number.isFinite(sampleRate) && sampleRate > 0) this.sampleRate = sampleRate;
    const snapshot = this.store.getState();
    if (snapshot.phase.kind !== "recording") return;
    const durationMs = this.sampleRate > 0
      ? Math.round((this.accumulator.frames / this.sampleRate) * 1000)
      : snapshot.phase.durationMs;
    this.store.setState({
      levelHistory: peak
        ? [...snapshot.levelHistory.slice(1 - MAX_METER_HISTORY), peak]
        : snapshot.levelHistory,
      phase: { kind: "recording", durationMs },
    });
  }

  /**
   * Full-recording columns, written to the store for the saved lane. When the
   * finalized file is longer than the frames seen by the callback, the tail
   * is padded as a gap so earlier columns keep their file position.
   */
  finalize(columns = SOURCE_COLUMNS, fileDurationSeconds?: number): WaveformPeak[] {
    this.capturing = false;
    if (fileDurationSeconds !== undefined && Number.isFinite(fileDurationSeconds) &&
        fileDurationSeconds > 0 && this.sampleRate > 0) {
      const missing = Math.round(fileDurationSeconds * this.sampleRate) - this.accumulator.frames;
      if (missing > 0 && Number.isSafeInteger(missing)) this.accumulator.skip(missing);
    }
    const peaks = this.accumulator.toColumns(columns);
    this.store.setState({ levelHistory: peaks });
    return peaks;
  }

  private fail(message: string): void {
    this.capturing = false;
    this.onFatal(message);
  }
}
