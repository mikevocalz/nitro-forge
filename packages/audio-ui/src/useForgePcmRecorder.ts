import { useEffect, useMemo, useRef } from "react";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamFileRecordingResult,
} from "expo-audio";
import type { StoreApi } from "zustand/vanilla";
import { ForgeRecordingController, type RecordingDriver, type RecordingSnapshot } from "./recording";
import { PcmCaptureSession } from "./pcmCapture";
import type { SourceRecordingFile } from "./sourceRecordingTypes";

export function useForgePcmRecorder(store: StoreApi<RecordingSnapshot>) {
  const controllerRef = useRef<ForgeRecordingController | null>(null);
  const session = useMemo(
    () => new PcmCaptureSession(store, "int16", (message) => {
      void controllerRef.current?.abort(message);
    }),
    [store],
  );
  const lastFile = useRef<AudioStreamFileRecordingResult | null>(null);

  // Expo Audio Stream captures actual interleaved signed PCM samples and
  // writes the 16-bit WAV file on the native side; JavaScript only retains
  // bounded peak extrema, never full PCM buffers.
  const { stream } = useAudioStream({
    sampleRate: 48000,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => session.onBuffer(buffer),
  });

  const controller = useMemo(() => {
    const driver: RecordingDriver = {
      requestPermission: async () => (await requestRecordingPermissionsAsync()).granted,
      configure: async () => {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      },
      // expo-audio has no getter for the prior mode; return to playback.
      release: () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }),
      prepare: async () => {
        session.reset();
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
        // Peaks accumulate only while the file is being written.
        session.openFileWindow();
      },
      stop: async () => {
        session.closeFileWindow();
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
    const created = new ForgeRecordingController(driver, store);
    controllerRef.current = created;
    return created;
  }, [session, store, stream]);

  useEffect(() => {
    // Reversible so StrictMode / Fast Refresh effect re-runs keep a usable
    // controller; detach() stops capture and writes failures to the store.
    controller.attach();
    // The stream reports isStreaming=false when the OS ends capture (call,
    // route loss, another app). The controller ignores it while it is busy
    // with its own start/stop, so only external stops become "interrupted".
    const statusSub = stream.addListener("audioStreamStatus", (status) => {
      if (status.isStreaming) return;
      session.closeFileWindow();
      controller.reportInterrupted();
    });
    return () => {
      statusSub.remove();
      void controller.detach();
    };
  }, [controller, session, stream]);

  const stop = async (): Promise<SourceRecordingFile> => {
    const uri = await controller.stop();
    const file = lastFile.current;
    if (!file || !uri) {
      throw new Error("WAV capture ended without a finalized native recording");
    }
    return {
      kind: "pcm-wav",
      uri,
      // Writes the full-recording columns into the store for the saved lane.
      peaks: session.finalize(),
      sampleRate: file.sampleRate,
      channels: file.channels,
      durationSeconds: file.duration,
      droppedBuffers: session.droppedBuffers,
    };
  };
  return { controller, stop };
}
