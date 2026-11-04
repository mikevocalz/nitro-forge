import { NativeRecordingTrack } from "./NativeRecordingTrack";
import { WaveformPeakAccumulator } from "./pcmPeaks";
import { postDecodeRejection, preDecodeRejection } from "./webDecodeBounds";
import type { NativeSourceRecordingTrackProps, SourceRecordingFile } from "./sourceRecordingTypes";

/** Cheap probe: read the container duration via an <audio> element. */
function probeDurationSeconds(uri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const done = () => { audio.removeAttribute("src"); audio.load(); };
    audio.onloadedmetadata = () => { const d = audio.duration; done(); resolve(d); };
    audio.onerror = () => { done(); reject(new Error("Browser cannot read recording metadata")); };
    audio.src = uri;
  });
}

async function decodeWebRecording(uri: string): Promise<SourceRecordingFile> {
  const unavailable = (reason: string): SourceRecordingFile => ({
    kind: "compressed-web", uri, peaks: [], waveform: "unavailable", reason,
  });
  if (!uri.startsWith("blob:")) return unavailable("Recording is not a browser Blob URL");
  let context: AudioContext | undefined;
  try {
    const response = await fetch(uri);
    if (!response.ok) return unavailable(`Fetching recording failed (${response.status})`);
    const data = await response.arrayBuffer();
    context = new AudioContext();
    // Bound decoded memory before decoding, then check the real buffer.
    const probed = await probeDurationSeconds(uri).catch(() => Number.NaN);
    const before = preDecodeRejection(data.byteLength, probed, context.sampleRate);
    if (before) return unavailable(before);
    let decoded: AudioBuffer | null = await context.decodeAudioData(data);
    const after = postDecodeRejection(decoded.length, decoded.numberOfChannels);
    if (after) {
      decoded = null; // drop the only reference before the context closes
      return unavailable(after);
    }
    if (decoded.length < 1 || decoded.numberOfChannels < 1) {
      return unavailable("Decoded recording has no audio frames");
    }
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
          if (!Number.isFinite(sample)) return unavailable("Decoded audio contains a nonfinite sample");
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
  } catch (error) {
    // Browser codecs vary (AAC/WebM on Safari/Firefox). Still deliver the
    // genuine saved recording URI with an explicit unavailable waveform and
    // the decoder's reason.
    return unavailable("Browser could not decode the recording: " +
      (error instanceof Error ? error.message : String(error)));
  } finally {
    if (context) {
      await context.close().catch((error: unknown) => {
        console.warn("[audio-ui] AudioContext.close failed", error);
      });
    }
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
          .catch((error: unknown) => onSaved?.({
            kind: "compressed-web", uri, peaks: [], waveform: "unavailable",
            reason: error instanceof Error ? error.message : String(error),
          }));
      }}
    />
  );
}
