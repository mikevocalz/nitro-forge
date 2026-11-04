/**
 * Native peak extraction for already-recorded, sandbox-local 16-bit PCM WAV files.
 * A small, independent first Expo Modules 2.0 slice; not an audio recorder/player.
 * No native work runs during SSR/import. Use from an Expo SDK 58 dev build.
 */
import { requireNativeModule } from "expo";

export interface WaveformPeak {
  readonly min: number;
  readonly max: number;
}
interface ForgeSignalNative {
  analyzeWavFile(uri: string, columns: number): Promise<number[][]>;
}

/** 1..4096 columns; returns a bounded pair of actual sample minima/maxima per column. */
export async function analyzeWavFile(
  fileUri: string,
  columns = 512,
): Promise<WaveformPeak[]> {
  if (!fileUri.startsWith("file://")) {
    throw new TypeError("Waveform analysis requires a local file:// URI");
  }
  if (!Number.isInteger(columns) || columns < 1 || columns > 4096) {
    throw new RangeError("columns must be an integer from 1 to 4096");
  }
  const native = requireNativeModule<ForgeSignalNative>("ForgeSignal");
  const pairs = await native.analyzeWavFile(fileUri, columns);
  if (!Array.isArray(pairs) || pairs.length !== columns) {
    throw new Error("Native waveform analyzer returned an invalid column count");
  }
  return pairs.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) {
      throw new Error("Native waveform analyzer returned an invalid peak pair");
    }
    const [min, max] = pair as [number, number];
    if (min < -1 || max > 1 || min > max) {
      throw new Error("Native waveform analyzer returned out-of-range samples");
    }
    return { min, max };
  });
}
