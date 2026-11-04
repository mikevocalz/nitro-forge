import { useEffect, useMemo, useRef } from "react";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamFileRecordingResult,
} from "expo-audio";
import type { StoreApi } from "zustand/vanilla";
import { ForgeRecordingController, type RecordingDriver, type RecordingSnapshot } from "./recording";
import { WaveformPeakAccumulator } from "./pcmPeaks";
import type { SourceRecordingFile } from "./sourceRecordingTypes";

export function useForgePcmRecorder(store: StoreApi<RecordingSnapshot>) {
  const accumulator = useMemo(() => new WaveformPeakAccumulator(4096), [store]);
  const lastFile = useRef<AudioStreamFileRecordingResult | null>(null);

  // Expo Audio Stream captures actual interleaved signed PCM samples and
  // writes the 16-bit WAV file on the native side; JavaScript only retains
  // bounded peak extrema, never full PCM buffers.
  const { stream } = useAudioStream({
    sampleRate: 48000,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => {
      try {
        const chunk = accumulator.appendPcm(buffer.data, buffer.channels, "int16");
        const snapshot = store.getState();
        if (snapshot.phase.kind !== "recording") return;
        store.setState({
          levelHistory: [...snapshot.levelHistory.slice(-159), chunk.peak],
          phase: {
            kind: "recording",
            durationMs: Math.max(0, Math.round(buffer.timestamp * 1000)),
          },
        });
      } catch {
        // A malformed native stream buffer must never create fake peaks.
        // A future error/event channel should surface backend failures.
      }
    },
  });

  const controller = useMemo(() => {
    const driver: RecordingDriver = {
      requestPermission: async () => (await requestRecordingPermissionsAsync()).granted,
      configure: async () => {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      },
      release: () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }),
      prepare: async () => {
        accumulator.reset();
        lastFile.current = null;
      },
      record: async () => {
        await stream.start();
        try {
          await stream.startFileRecordingAsync({
            directory: "document",
            format: "wav",
          });
        } catch (error) {
          stream.stop();
          throw error;
        }
      },
      stop: async () => {
        try {
          const file = await stream.stopFileRecordingAsync();
          lastFile.current = file;
          return file.uri;
        } finally {
          stream.stop();
        }
      },
      getStatus: () => {
        const phase = store.getState().phase;
        return {
          isRecording: stream.isStreaming,
          durationMillis: phase.kind === "recording" ? phase.durationMs : 0,
        };
      },
    };
    return new ForgeRecordingController(driver, store);
  }, [accumulator, store, stream]);

  useEffect(() => {
    return () => {
      void controller.dispose().catch(() => undefined);
    };
  }, [controller]);

  const stop = async (): Promise<SourceRecordingFile> => {
    const uri = await controller.stop();
    const file = lastFile.current;
    if (!file || !uri) {
      throw new Error("WAV capture ended without a finalized native recording");
    }
    return {
      kind: "pcm-wav",
      uri,
      peaks: accumulator.toColumns(512),
      sampleRate: file.sampleRate,
      channels: file.channels,
      durationSeconds: file.duration,
    };
  };
  return { controller, stop };
}
