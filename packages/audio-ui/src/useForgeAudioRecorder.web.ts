import { useEffect, useMemo, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import { ForgeRecordingController, type RecordingDriver, type RecordingSnapshot } from "./recording";

/** Audio API has no browser recorder. Browser MediaRecorder owns capture; no Expo adapter. */
export function useForgeAudioRecorder(store: StoreApi<RecordingSnapshot>) {
  const current = useRef<ForgeRecordingController | null>(null);
  useEffect(() => {
    // Prior owner's Blob URLs/tracks were released during cleanup.
    store.setState({ phase: { kind: "idle" }, levelHistory: [] });
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let bytes = 0;
    let started = 0;
    let disposed = false;
    let uri: string | null = null;
    let completion: Promise<string> | null = null;
    const release = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; };
    const driver: RecordingDriver = {
      requestPermission: async () => {
        // Previous onstop owns its stream/chunks until it has fully finalized.
        await completion?.catch(() => undefined);
        if (disposed) return false;
        if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
          throw new Error("Microphone capture needs HTTPS and browser MediaRecorder support");
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (disposed) { release(); return false; }
          return true;
        } catch (error) {
          if (error instanceof DOMException && error.name === "NotAllowedError") return false;
          throw error;
        }
      },
      configure: async () => {},
      // Browsers have no app audio session to hand back; tracks are stopped in onstop/onerror.
      release: async () => {},
      prepare: async () => {
        if (!stream) throw new Error("Microphone stream is unavailable");
        if (uri) URL.revokeObjectURL(uri);
        uri = null; chunks = []; bytes = 0;
        try { recorder = new MediaRecorder(stream); } catch (error) { release(); throw error; }
      },
      record: () => {
        if (!recorder) throw new Error("Browser recorder is not prepared");
        const active = recorder;
        completion = new Promise<string>((resolve, reject) => {
          let failure: Error | null = null;
          active.ondataavailable = event => {
            bytes += event.data.size;
            if (bytes > 64 * 1024 * 1024) {
              failure = new Error("Recording exceeded the 64 MiB browser capture limit");
              chunks = []; if (active.state !== "inactive") active.stop();
            } else if (!failure && event.data.size) chunks.push(event.data);
          };
          active.onerror = () => {
            failure = new Error("Browser microphone recording failed");
            release();
            if (active.state !== "inactive") active.stop();
            if (!disposed) store.setState({ phase: { kind: "error", message: failure.message } });
            // Standard MediaRecorder dispatches dataavailable/onstop after error;
            // settle only there, so retry cannot reuse resources before cleanup.
          };
          active.onstop = () => {
            release();
            active.ondataavailable = null; active.onerror = null; active.onstop = null;
            if (disposed) { chunks = []; reject(new Error("Recording disposed")); return; }
            if (failure || !chunks.length) {
              const error = failure ?? new Error("Browser recording is empty");
              store.setState({ phase: { kind: "error", message: error.message } });
              chunks = []; reject(error); return;
            }
            uri = URL.createObjectURL(new Blob(chunks, { type: active.mimeType })); chunks = [];
            resolve(uri);
          };
          try { active.start(250); started = performance.now(); }
          catch (error) { release(); reject(error); }
        });
        // Errors are reported through store even before a user asks to stop.
        void completion.catch(() => undefined);
        if (active.state !== "recording") throw new Error("Browser recorder could not start");
      },
      stop: async () => {
        if (!recorder || !completion) { release(); throw new Error("No active browser recording"); }
        if (recorder.state !== "inactive") recorder.stop();
        return completion;
      },
      getStatus: () => ({ isRecording: recorder?.state === "recording", durationMillis: performance.now() - started }),
    };
    const controller = new ForgeRecordingController(driver, store); current.current = controller;
    const timer = setInterval(() => controller.observe(driver.getStatus()), 100);
    // Hidden tab: end capture (releasing the microphone) but leave saving to
    // the user, so the clip still reaches onSaved through the track's stop().
    const visibility = () => {
      if (!document.hidden || store.getState().phase.kind !== "recording") return;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      controller.reportInterrupted();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; current.current = null; clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility); release();
      void controller.dispose().catch(() => undefined);
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [store]);
  return useMemo(() => ({
    start: async () => { if (!current.current) throw new Error("Recorder not mounted"); return current.current.start(); },
    stop: async () => { if (!current.current) throw new Error("Recorder not mounted"); return current.current.stop(); },
  }), []);
}
