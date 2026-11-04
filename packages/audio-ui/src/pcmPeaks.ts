import type { WaveformPeak } from "@nitro-forge/media-ui";

export type PcmEncoding = "int16" | "float32";
export interface PcmPeakChunk {
  readonly peak: WaveformPeak;
  readonly frames: number;
}
interface TimePeak extends WaveformPeak {
  readonly startFrame: number;
  readonly endFrame: number;
}

export function peakFromPcmBuffer(
  data: ArrayBuffer,
  channels: number,
  encoding: PcmEncoding,
): PcmPeakChunk {
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new RangeError("PCM channel count must be 1..8");
  }
  const sampleBytes = encoding === "int16" ? 2 : encoding === "float32" ? 4 : 0;
  if (!sampleBytes || data.byteLength < sampleBytes * channels ||
      data.byteLength % (sampleBytes * channels) !== 0) {
    throw new RangeError("PCM buffer must contain complete interleaved frames");
  }
  const view = new DataView(data);
  const frames = data.byteLength / (sampleBytes * channels);
  let min = 1, max = -1;
  for (let offset = 0; offset < data.byteLength; offset += sampleBytes) {
    const normalized = encoding === "int16"
      ? view.getInt16(offset, true) / 32768
      : view.getFloat32(offset, true);
    if (!Number.isFinite(normalized)) {
      throw new RangeError("PCM buffer contains a nonfinite sample");
    }
    min = Math.min(min, normalized);
    max = Math.max(max, normalized);
  }
  return {
    frames,
    peak: { min: Math.max(-1, min), max: Math.min(1, max) },
  };
}

/**
 * Bounded time-aware extrema pyramid. Every original PCM chunk contributes
 * to the final waveform without retaining any audio samples in JS memory.
 */
export class WaveformPeakAccumulator {
  private peaks: TimePeak[] = [];
  private currentFrame = 0;

  constructor(private readonly maxSegments = 4096) {
    if (!Number.isInteger(maxSegments) || maxSegments < 2 ||
        maxSegments > 32768) {
      throw new RangeError("Peak segment budget must be between 2 and 32768");
    }
  }

  reset(): void {
    this.peaks = [];
    this.currentFrame = 0;
  }

  append(peak: WaveformPeak, frameCount: number): void {
    if (!Number.isSafeInteger(frameCount) || frameCount <= 0 ||
        !Number.isSafeInteger(this.currentFrame + frameCount)) {
      throw new RangeError("Invalid PCM duration");
    }
    if (![peak.min, peak.max].every(Number.isFinite) || peak.min > peak.max ||
        peak.min < -1 || peak.max > 1) {
      throw new RangeError("Invalid PCM peak extrema");
    }
    const startFrame = this.currentFrame;
    this.currentFrame += frameCount;
    this.peaks.push({ ...peak, startFrame, endFrame: this.currentFrame });

    if (this.peaks.length > this.maxSegments) {
      const compact: TimePeak[] = [];
      for (let i = 0; i < this.peaks.length; i += 2) {
        const a = this.peaks[i]!;
        const b = this.peaks[i + 1];
        compact.push(b
          ? { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max),
              startFrame: a.startFrame, endFrame: b.endFrame }
          : a);
      }
      this.peaks = compact;
    }
  }

  appendPcm(data: ArrayBuffer, channels: number, encoding: PcmEncoding): PcmPeakChunk {
    const chunk = peakFromPcmBuffer(data, channels, encoding);
    this.append(chunk.peak, chunk.frames);
    return chunk;
  }

  get frames(): number { return this.currentFrame; }
  get segments(): number { return this.peaks.length; }

  toColumns(columns: number): WaveformPeak[] {
    if (!Number.isInteger(columns) || columns < 1 || columns > 4096) {
      throw new RangeError("Waveform columns must be 1..4096");
    }
    if (!this.peaks.length) {
      return Array.from({ length: columns }, () => ({ min: 0, max: 0 }));
    }
    let position = 0;
    return Array.from({ length: columns }, (_, index) => {
      const start = this.currentFrame * index / columns;
      const end = this.currentFrame * (index + 1) / columns;
      while (position < this.peaks.length - 1 &&
        this.peaks[position]!.endFrame <= start) {
        position++;
      }
      let min = 1, max = -1;
      for (let i = position; i < this.peaks.length; i++) {
        const bin = this.peaks[i]!;
        if (bin.startFrame >= end) break;
        if (bin.endFrame > start) {
          min = Math.min(min, bin.min);
          max = Math.max(max, bin.max);
        }
      }
      return max < min ? { min: 0, max: 0 } : { min, max };
    });
  }
}
