import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import {
  AudioManager, AudioRecorder, FileDirectory, FileFormat, FilePreset, BitDepth,
} from "react-native-audio-api";
import type { StoreApi } from "zustand/vanilla";
import { ForgeRecordingController, type RecordingDriver, type RecordingSnapshot } from "./recording";
import { WaveformPeakAccumulator } from "./pcmPeaks";
import { planarPeak, recordingFileUri, stopAfterStart } from "./audioApiContracts";
import type { SourceRecordingFile } from "./sourceRecordingTypes";

/** Native-only import: AudioRecorder is not available in Audio API's web entry. */
export function useForgePcmRecorder(store: StoreApi<RecordingSnapshot>) {
  const session = useRef<{
    controller: ForgeRecordingController;
    stop: () => Promise<SourceRecordingFile>;
  } | null>(null);

  useEffect(() => {
    // A new resource owner cannot inherit another recorder's transient state.
    if (store.getState().phase.kind !== "saved") store.setState({ phase: { kind: "idle" }, levelHistory: [] });
    // Create resources in the effect, never render. StrictMode gets a fresh owner.
    const recorder = new AudioRecorder();
    const accumulator = new WaveformPeakAccumulator(4096);
    let finalized: Extract<SourceRecordingFile, { kind: "pcm-wav" }> | null = null;
    let failure: string | null = null;
    let disposed = false;
    let stopping: Promise<string> | null = null;
    let starting: ReturnType<AudioRecorder["start"]> | null = null;
    let registrationError: string | null = null;
    const stopNative = (): Promise<string> => {
      if (stopping) return stopping;
      stopping = (async () => {
        // Stop must run after an in-flight start, even on interruption/unmount.
        const result = await stopAfterStart(starting, () => recorder.stop());
        if (result.status === "error") throw new Error(result.message);
        const uri = recordingFileUri(result.paths);
        if (!Number.isFinite(result.duration) || result.duration < 0) throw new Error("Invalid recording duration");
        finalized = { kind: "pcm-wav", uri, peaks: accumulator.frames ? accumulator.toColumns(512) : [],
          sampleRate: 48000, channels: 1, durationSeconds: result.duration };
        return uri;
      })();
      return stopping;
    };
    const fail = (message: string) => {
      failure = message;
      if (!disposed) store.setState({ phase: { kind: "error", message } });
      // Never silently keep the microphone open after an error/interruption.
      void stopNative().catch(() => undefined);
    };
    const driver: RecordingDriver = {
      requestPermission: async () => {
        if (registrationError) throw new Error(registrationError);
        await stopping?.catch(() => undefined);
        stopping = null; failure = null;
        return (await AudioManager.requestRecordingPermissions()) === "Granted";
      },
      configure: async () => {
        AudioManager.setSystemOptions({ ios: { category: "playAndRecord", mode: "default", options: ["defaultToSpeaker"] } });
        if (AppState.currentState && AppState.currentState !== "active") throw new Error("Recording requires the foreground app");
      },
      prepare: async () => {
        // A previous error's shutdown must finish before the next recording.
        await stopping?.catch(() => undefined);
        if (failure) throw new Error(failure);
        stopping = null; starting = null; finalized = null; accumulator.reset();
        recorder.enableFileOutput({ directory: FileDirectory.Document, subDirectory: "Forge", format: FileFormat.Wav,
          channelCount: 1, rotateIntervalBytes: 0, preset: { ...FilePreset.High, sampleRate: 48000, bitDepth: BitDepth.Bit16 } });
      },
      record: async () => {
        if (failure || disposed) throw new Error(failure ?? "Recorder disposed");
        starting = recorder.start();
        let result: Awaited<ReturnType<AudioRecorder["start"]>>;
        try { result = await starting; } catch (error) {
          await stopNative().catch(() => undefined);
          throw error;
        }
        if (result.status === "error" || failure || disposed) {
          await stopNative().catch(() => undefined);
          throw new Error(result.status === "error" ? result.message : failure ?? "Recorder disposed");
        }
      },
      stop: stopNative,
      getStatus: () => ({ isRecording: recorder.isRecording(), durationMillis: recorder.getCurrentDuration() * 1000 }),
    };
    const controller = new ForgeRecordingController(driver, store);
    recorder.onError(({ message }) => fail(message));
    const subscription = recorder.onAudioReady({ sampleRate: 48000, channelCount: 1, bufferLength: 4800 }, ({ buffer, numFrames, when }) => {
      if (disposed || failure) return;
      try {
        const peak = planarPeak(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), numFrames);
        accumulator.append(peak, numFrames);
        if (store.getState().phase.kind === "recording") store.setState({
          levelHistory: [...store.getState().levelHistory.slice(-159), peak],
          phase: { kind: "recording", durationMs: Math.max(0, Math.round((when + numFrames / buffer.sampleRate) * 1000)) },
        });
      } catch (error) { fail(error instanceof Error ? error.message : "PCM callback failed"); }
    });
    if (subscription.status === "error") { registrationError = subscription.message; fail(subscription.message); }
    const appState = AppState.addEventListener("change", state => {
      if (state !== "active" && ["recording", "preparing"].includes(store.getState().phase.kind)) fail("Recording interrupted when app left foreground. Start again to retry.");
    });
    const interruption = AudioManager.addSystemEventListener("interruption", event => {
      if (event.type === "began" && ["recording", "preparing"].includes(store.getState().phase.kind)) fail("Audio session interrupted. Start again to retry.");
    });
    session.current = {
      controller,
      stop: async () => {
        await controller.stop();
        if (failure) throw new Error(failure);
        if (!finalized || disposed) throw new Error("No finalized recording available");
        store.setState({ phase: { kind: "saved", uri: finalized.uri, durationMs: Math.round(finalized.durationSeconds * 1000) } });
        return finalized;
      },
    };
    return () => {
      disposed = true; session.current = null;
      appState.remove(); interruption.remove(); recorder.clearOnAudioReady(); recorder.clearOnError();
      void controller.dispose().catch(() => undefined);
      void stopNative().catch(() => undefined);
    };
  }, [store]);
  return useMemo(() => ({
    controller: { start: async () => {
      if (!session.current) throw new Error("Audio recorder is not mounted");
      return session.current.controller.start();
    } },
    stop: async () => {
      if (!session.current) throw new Error("Audio recorder is not mounted");
      return session.current.stop();
    },
  }), []);
}
