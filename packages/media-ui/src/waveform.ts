/** Deterministic reduced waveform data shared by native and web renderers. */
export interface WaveformPeak {
  readonly min: number;
  readonly max: number;
}
export function normalizePeak(peak: WaveformPeak): WaveformPeak {
  if (!Number.isFinite(peak.min) || !Number.isFinite(peak.max)) {
    throw new RangeError("Waveform peak must be finite");
  }
  if (peak.min > peak.max) {
    throw new RangeError("Waveform min exceeds max");
  }
  return {
    min: Math.min(1, Math.max(-1, peak.min)),
    max: Math.min(1, Math.max(-1, peak.max)),
  };
}

/**
 * Preserve extrema while reducing waveform data into a display-width tile.
 * Never average peaks: averaging hides transients and clipping.
 * Display-only; source PCM stays in the native audio engine.
 */
export function resamplePeaks(
  input: readonly WaveformPeak[],
  columns: number,
): WaveformPeak[] {
  if (!Number.isInteger(columns) || columns < 1 || columns > 4096) {
    throw new RangeError("columns must be 1..4096");
  }
  if (input.length === 0) {
    return Array.from({ length: columns }, () => ({ min: 0, max: 0 }));
  }
  const normalized = input.map(normalizePeak);
  return Array.from({ length: columns }, (_, column) => {
    const start = Math.floor(column * normalized.length / columns);
    const end = Math.max(start + 1, Math.ceil((column + 1) * normalized.length / columns));
    let min = 1;
    let max = -1;
    for (let i = start; i < Math.min(end, normalized.length); i++) {
      const peak = normalized[i]!;
      min = Math.min(min, peak.min);
      max = Math.max(max, peak.max);
    }
    return { min, max };
  });
}

export interface WaveformBar {
  readonly top: number;
  readonly height: number;
}
/** Convert normalized samples to native layout units, preserving positive/negative offset. */
export function peaksToBars(
  peaks: readonly WaveformPeak[],
  height: number,
): WaveformBar[] {
  if (!Number.isFinite(height) || height <= 0 || height > 8192) {
    throw new RangeError("Waveform height outside supported range");
  }
  return peaks.map((raw) => {
    const peak = normalizePeak(raw);
    const top = ((1 - peak.max) / 2) * height;
    const bottom = ((1 - peak.min) / 2) * height;
    return { top, height: Math.max(1, bottom - top) };
  });
}
