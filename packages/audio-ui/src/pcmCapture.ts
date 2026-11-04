import type { StoreApi } from "zustand/vanilla";
import type { WaveformPeak } from "@nitro-forge/media-ui";
import { MAX_METER_HISTORY, type RecordingSnapshot } from "./recording";
import { WaveformPeakAccumulator, type PcmEncoding } from "./pcmPeaks";

/** Column count of the full-recording waveform shown after saving. */
export const SOURCE_COLUMNS = 512;

export interface PcmBuffer {
  readonly data: ArrayBuffer;
  readonly channels: number;
  readonly sampleRate: number;
  readonly timestamp: number;
}

/**
 * Accumulates peaks only for buffers that land in the WAV file: the window
 * opens after startFileRecordingAsync() resolves and closes before
 * stopFileRecordingAsync() is called. Buffers streamed outside it are not
 * in the file and are ignored, so peak positions match file time.
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

  onBuffer(buffer: PcmBuffer): void {
    if (!this.capturing) return;
    if (Number.isFinite(buffer.sampleRate) && buffer.sampleRate > 0) {
      this.sampleRate = buffer.sampleRate;
    }
    let peak: WaveformPeak | undefined;
    try {
      peak = this.accumulator.appendPcm(buffer.data, buffer.channels, this.encoding).peak;
    } catch (error) {
      const bytesPerFrame = (this.encoding === "int16" ? 2 : 4) * buffer.channels;
      const frames = Number.isInteger(buffer.channels) && buffer.channels > 0
        ? Math.floor(buffer.data.byteLength / bytesPerFrame)
        : 0;
      if (frames < 1) {
        this.fail("Unreadable PCM buffer from the native stream: " +
          (error instanceof Error ? error.message : String(error)));
        return;
      }
      // Keep the timeline aligned with the file; the gap stays visible.
      this.dropped++;
      this.accumulator.skip(frames);
    }
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

  /** Full-recording columns, written to the store for the saved lane. */
  finalize(columns = SOURCE_COLUMNS): WaveformPeak[] {
    this.capturing = false;
    const peaks = this.accumulator.toColumns(columns);
    this.store.setState({ levelHistory: peaks });
    return peaks;
  }

  private fail(message: string): void {
    this.capturing = false;
    this.onFatal(message);
  }
}
