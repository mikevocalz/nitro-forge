import { useEffect, useMemo } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import type { StoreApi } from "zustand/vanilla";
import {
  ForgeRecordingController,
  type RecordingDriver,
  type RecordingSnapshot,
} from "./recording";

/**
 * All platforms use the SDK 58 native recorder (AVAudioRecorder, Android
 * MediaRecorder, browser MediaRecorder). React owns the native handle; the
 * Forge state machine and consumers use Zustand only.
 *
 * This is a hook so native resources follow React mount/unmount correctly.
 * A different document/track must mount a separate recording owner.
 */
export function useForgeAudioRecorder(
  store: StoreApi<RecordingSnapshot>,
): ForgeRecordingController {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    directory: "document",
    isMeteringEnabled: true,
  });
  const controller = useMemo(() => {
    const driver: RecordingDriver = {
      requestPermission: async () => (await requestRecordingPermissionsAsync()).granted,
      configure: async () => {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      },
      prepare: () => recorder.prepareToRecordAsync(),
      record: () => recorder.record(),
      stop: async () => {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error("Recording stopped without a saved native file URI");
        return uri;
      },
      getStatus: () => recorder.getStatus(),
    };
    return new ForgeRecordingController(driver, store);
  }, [recorder, store]);

  useEffect(() => {
    // Status polling is intentionally low frequency; PCM audio buffers remain
    // inside the platform recorder, never forwarded over JS frame callbacks.
    const poll = setInterval(() => {
      try { controller.observe(recorder.getStatus()); }
      catch { /* Native resource may already be released during unmount. */ }
    }, 100);
    return () => {
      clearInterval(poll);
      void controller.dispose().catch(() => undefined);
    };
  }, [controller, recorder]);

  return controller;
}
