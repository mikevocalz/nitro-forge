import { NativeRecordingTrack } from "./NativeRecordingTrack";
import { WaveformPeakAccumulator } from "./pcmPeaks";
import type { NativeSourceRecordingTrackProps, SourceRecordingFile } from "./sourceRecordingTypes";

async function decodeWebRecording(uri: string): Promise<SourceRecordingFile> {
  const unavailable = (): SourceRecordingFile => ({
    kind: "compressed-web", uri, peaks: [], waveform: "unavailable",
  });
  if (!uri.startsWith("blob:")) return unavailable();
  let context: AudioContext | undefined;
  try {
    const response = await fetch(uri);
    if (!response.ok) return unavailable();
    const data = await response.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > 64 * 1024 * 1024) {
      return unavailable();
    }
    context = new AudioContext();
    const decoded = await context.decodeAudioData(data);
    if (decoded.length < 1 || decoded.numberOfChannels < 1) return unavailable();
    const accumulator = new WaveformPeakAccumulator();
    const chunkFrames = 2048;
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    );
    for (let start = 0; start < decoded.length; start += chunkFrames) {
      const end = Math.min(decoded.length, start + chunkFrames);
      let min = 1, max = -1;
      for (const channel of channels) {
        for (let i = start; i < end; i++) {
          const sample = channel[i]!;
          if (!Number.isFinite(sample)) return unavailable();
          min = Math.min(min, sample);
          max = Math.max(max, sample);
        }
      }
      accumulator.append(
        { min: Math.max(-1, min), max: Math.min(1, max) },
        end - start,
      );
    }
    return {
      kind: "compressed-web", uri, peaks: accumulator.toColumns(512),
      waveform: "decoded",
    };
  } catch {
    // Browser codecs vary (AAC/WebM on Safari/Firefox). Still deliver the
    // genuine saved recording URI with an explicit unavailable waveform.
    return unavailable();
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/** Web: real browser MediaRecorder; decode actual saved clip for source peaks when supported. */
export function NativeSourceRecordingTrack({
  store, disabled, testID, onSaved,
}: NativeSourceRecordingTrackProps) {
  return (
    <NativeRecordingTrack
      store={store}
      {...(disabled === undefined ? {} : { disabled })}
      {...(testID ? { testID } : {})}
      onSaved={(uri) => {
        void decodeWebRecording(uri)
          .then((result) => onSaved?.(result))
          .catch(() => onSaved?.({
            kind: "compressed-web", uri, peaks: [], waveform: "unavailable",
          }));
      }}
    />
  );
}
