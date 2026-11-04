import type { StoreApi } from "zustand/vanilla";
import type { RecordingSnapshot } from "./recording";
import { useForgePcmRecorder } from "./useForgePcmRecorder";

/** Native compatibility facade: recording is owned by Audio API, never Expo Audio. */
export function useForgeAudioRecorder(store: StoreApi<RecordingSnapshot>) {
  const pcm = useForgePcmRecorder(store);
  return { start: pcm.controller.start, stop: async () => (await pcm.stop()).uri };
}
