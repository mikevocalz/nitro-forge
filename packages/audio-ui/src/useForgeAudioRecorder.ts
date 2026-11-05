import type { StoreApi } from "zustand/vanilla";
import type { RecordingSnapshot } from "./recording";
import { useForgePcmRecorder } from "./useForgePcmRecorder";

/**
 * Native compatibility facade: recording is owned by Audio API's
 * AudioRecorder (see useForgePcmRecorder), never Expo Audio. Web resolves
 * useForgeAudioRecorder.web.ts (browser MediaRecorder).
 */
export function useForgeAudioRecorder(store: StoreApi<RecordingSnapshot>) {
  const pcm = useForgePcmRecorder(store);
  return { start: pcm.controller.start, stop: async () => (await pcm.stop()).uri };
}
