import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import {
  AudioManager, AudioRecorder, FileDirectory, FileFormat, FilePreset, BitDepth,
} from "react-native-audio-api";
import type { StoreApi } from "zustand/vanilla";
import { ForgeRecordingController, type RecordingDriver, type RecordingSnapshot } from "./recording";
import { PcmCaptureSession, SOURCE_COLUMNS } from "./pcmCapture";
import { recordingFileUri, stopAfterStart } from "./audioApiContracts";
import type { SourceRecordingFile } from "./sourceRecordingTypes";

const FILE_SAMPLE_RATE = 48000;
const STATUS_POLL_MS = 250;

interface FinalizedFile {
  readonly uri: string;
  readonly durationSeconds: number;
}

/**
 * Native-only import: AudioRecorder is not available in Audio API's web entry.
 *
 * Each effect run owns a fresh AudioRecorder and controller, so StrictMode and
 * Fast Refresh re-runs never reuse a recorder whose effect was cleaned up.
 * Cleanup disposes that owner permanently; the next run builds a new one.
 */
export function useForgePcmRecorder(store: StoreApi<RecordingSnapshot>) {
  const session = useRef<{
    start: () => Promise<boolean>;
    stop: () => Promise<SourceRecordingFile>;
  } | null>(null);

  useEffect(() => {
    // A new resource owner cannot inherit another recorder's transient state.
    if (store.getState().phase.kind !== "saved") store.setState({ phase: { kind: "idle" }, levelHistory: [] });
    const recorder = new AudioRecorder();
    let controller: ForgeRecordingController | null = null;
    // Unreadable stream: stop native capture and show the failure.
    const capture = new PcmCaptureSession(store, "int16", (message) => {
      void controller?.abort(message);
    });
    let finalized: FinalizedFile | null = null;
    let stopping: Promise<string> | null = null;
    let starting: ReturnType<AudioRecorder["start"]> | null = null;
    // A failure or interruption that arrived while start() was in flight.
    let pendingFailure: string | null = null;
    let pendingInterruption: string | null = null;
    let confirmedRecording = false;
    let disposed = false;

    const stopNative = (): Promise<string> => {
      if (stopping) return stopping;
      stopping = (async () => {
        try {
          // Stop must run after an in-flight start, even on interruption/unmount.
          const result = await stopAfterStart(starting, () => recorder.stop());
          if (result.status === "error") throw new Error(result.message);
          if (!Number.isFinite(result.duration) || result.duration < 0) {
            throw new Error("Recorder returned an invalid duration");
          }
          const uri = recordingFileUri(result.paths);
          finalized = { uri, durationSeconds: result.duration };
          return uri;
        } finally {
          // Every callback emitted before the file closed has been delivered.
          capture.closeFileWindow();
        }
      })();
      return stopping;
    };

    /**
     * The OS or app lifecycle ended capture. Finalize the partial file now so
     * the microphone is released, and let the user save it from "interrupted".
     */
    const interrupt = (message: string) => {
      if (disposed || !controller) return;
      const kind = store.getState().phase.kind;
      if (kind === "preparing" || kind === "requesting-permission") {
        pendingInterruption = message;
        return;
      }
      if (kind !== "recording") return;
      capture.closeFileWindow();
      controller.reportInterrupted();
      void stopNative().catch((error: unknown) => {
        void controller?.abort("Finalizing interrupted recording failed: " +
          (error instanceof Error ? error.message : String(error)));
      });
    };

    const driver: RecordingDriver = {
      requestPermission: async () => {
        // A previous recording's shutdown must finish before a new one starts;
        // its failure was already reported through the store.
        await stopping?.catch(() => undefined);
        stopping = null; starting = null; finalized = null;
        pendingFailure = null; pendingInterruption = null;
        return (await AudioManager.requestRecordingPermissions()) === "Granted";
      },
      configure: async () => {
        if (AppState.currentState && AppState.currentState !== "active") {
          throw new Error("Recording requires the foreground app");
        }
        AudioManager.setSystemOptions({ ios: { category: "playAndRecord", mode: "default", options: ["defaultToSpeaker"] } });
        AudioManager.observeAudioInterruptions(true);
      },
      // Undo configure(). The session is not deactivated: a preview
      // AudioContext may still own running output I/O, and deactivating an
      // active session fails on iOS. Returning to the playback category drops
      // the input route and the receiver-only output of playAndRecord.
      release: async () => {
        AudioManager.observeAudioInterruptions(false);
        AudioManager.setSystemOptions({ ios: { category: "playback", mode: "default", options: [] } });
      },
      prepare: async () => {
        capture.reset();
        confirmedRecording = false;
        recorder.enableFileOutput({ directory: FileDirectory.Document, subDirectory: "Forge", format: FileFormat.Wav,
          channelCount: 1, rotateIntervalBytes: 0, preset: { ...FilePreset.High, sampleRate: FILE_SAMPLE_RATE, bitDepth: BitDepth.Bit16 } });
      },
      record: async () => {
        if (disposed) throw new Error("Recorder disposed");
        // The file and onAudioReady are fed from the same native stream once
        // start() runs, so the peak window opens with it.
        capture.openFileWindow();
        starting = recorder.start();
        const result = await starting;
        // On failure the controller stops native capture and releases the session.
        if (result.status === "error") throw new Error(result.message);
        if (pendingFailure) throw new Error(pendingFailure);
        if (pendingInterruption) throw new Error(pendingInterruption);
      },
      stop: stopNative,
      getStatus: () => ({ isRecording: recorder.isRecording(), durationMillis: recorder.getCurrentDuration() * 1000 }),
    };
    const owned = new ForgeRecordingController(driver, store);
    controller = owned;

    recorder.onError(({ message }) => {
      capture.closeFileWindow();
      const kind = store.getState().phase.kind;
      if (kind === "recording" || kind === "interrupted") void owned.abort(message);
      else pendingFailure = message;
    });
    const subscription = recorder.onAudioReady(
      { sampleRate: FILE_SAMPLE_RATE, channelCount: 1, bufferLength: 4800 },
      ({ buffer, numFrames }) => {
        if (disposed) return;
        let channels: Float32Array[];
        try {
          channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        } catch {
          // Unreadable channel data: the frame count still positions the gap.
          channels = [];
        }
        capture.onPlanarBuffer(channels, numFrames, buffer.sampleRate);
      },
    );
    const registrationError = subscription.status === "error" ? subscription.message : null;

    // Android can end the input stream without an interruption event.
    const poll = setInterval(() => {
      if (store.getState().phase.kind !== "recording") return;
      let running: boolean;
      try { running = recorder.isRecording(); }
      catch (error) { void owned.reportStatusError(error); return; }
      if (running) confirmedRecording = true;
      else if (confirmedRecording) interrupt("Recording stopped by the system. Save the partial WAV or start again.");
    }, STATUS_POLL_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") interrupt("Recording stopped when the app left the foreground. Save the partial WAV or start again.");
    });
    const interruption = AudioManager.addSystemEventListener("interruption", (event) => {
      if (event.type === "began") interrupt("Audio session interrupted. Save the partial WAV or start again.");
    });

    session.current = {
      start: async () => {
        if (registrationError) throw new Error("PCM callback registration failed: " + registrationError);
        const started = await owned.start();
        // An interruption that landed between start() resolving and the
        // "recording" phase is applied now instead of being lost.
        if (started && pendingInterruption) interrupt(pendingInterruption);
        return started;
      },
      stop: async () => {
        await owned.stop();
        const file: FinalizedFile | null = finalized;
        if (!file || disposed) throw new Error("WAV capture ended without a finalized native recording");
        return {
          kind: "pcm-wav",
          uri: file.uri,
          // Writes the full-recording columns into the store for the saved lane.
          peaks: capture.finalize(SOURCE_COLUMNS, file.durationSeconds),
          sampleRate: FILE_SAMPLE_RATE,
          channels: 1,
          durationSeconds: file.durationSeconds,
          droppedBuffers: capture.droppedBuffers,
        };
      },
    };
    return () => {
      disposed = true; session.current = null; controller = null;
      clearInterval(poll); appState.remove(); interruption.remove();
      recorder.clearOnAudioReady(); recorder.clearOnError();
      // dispose() stops live capture, releases the session and writes any
      // teardown failure into the store.
      void owned.dispose();
    };
  }, [store]);

  return useMemo(() => ({
    controller: {
      start: async () => {
        if (!session.current) throw new Error("Audio recorder is not mounted");
        return session.current.start();
      },
    },
    stop: async () => {
      if (!session.current) throw new Error("Audio recorder is not mounted");
      return session.current.stop();
    },
  }), []);
}
