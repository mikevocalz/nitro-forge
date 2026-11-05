import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { AudioContext, type AudioBuffer } from "react-native-audio-api";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { AudioPreview } from "@nyc-tron/ui/components/forge/audio/AudioPreview";
import type { WaveformPeak } from "@nitro-forge/media-ui";
import { ForgeAudioPlayback, type PlaybackContext, type PlaybackSnapshot } from "./audioPlayback";
import { claimPlayback } from "./playbackOwnership";
import { toPreviewViewState } from "./previewView";

/** Playhead refresh while a preview plays; matches the view's 0.1 s display. */
const POSITION_TICK_MS = 100;

interface PreviewStore {
  readonly snapshot: PlaybackSnapshot;
  readonly positionSeconds: number;
}

export interface NativeAudioPreviewProps {
  /** Saved take to audition, or null before one exists. */
  readonly uri: string | null;
  /** Length of the saved take from the recorder, shown before decoding. */
  readonly durationSeconds: number;
  /** Measured peaks of the take; omit to hide the lane. */
  readonly peaks?: readonly WaveformPeak[];
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * Forge's Audio API preview player drawn with NYC-Tron's AudioPreview. One
 * AudioContext and one source per owner; decoding and scheduling stay on the
 * native graph. Same code on iOS, Android and web.
 */
export function NativeAudioPreview({
  uri, durationSeconds, peaks, disabled = false, testID,
}: NativeAudioPreviewProps) {
  const store = useMemo(() => createStore<PreviewStore>(() => ({
    snapshot: { phase: "idle", message: "Record a clip to preview", duration: 0 },
    positionSeconds: 0,
  })), []);
  const state = useStore(store);
  const player = useRef<ForgeAudioPlayback<AudioBuffer> | null>(null);
  useEffect(() => {
    let claim: (() => void) | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    const stopTicking = () => { if (tick) clearInterval(tick); tick = null; };
    const current = new ForgeAudioPlayback<AudioBuffer>(() => {
      const context = new AudioContext();
      const graph: PlaybackContext<AudioBuffer> = {
        get currentTime() { return context.currentTime; },
        destination: context.destination,
        decodeAudioData: uri => context.decodeAudioData(uri),
        resume: () => context.resume(), close: () => context.close(),
        createBufferSource: () => {
          const node = context.createBufferSource();
          let ended: (() => void) | null | undefined;
          return {
            get buffer() { return node.buffer; }, set buffer(value) { node.buffer = value; },
            get onended() { return ended; }, set onended(value) { ended = value; node.onended = value ? () => value() : null; },
            connect: () => node.connect(context.destination), disconnect: () => node.disconnect(),
            start: (when, offset) => node.start(when, offset), stop: () => node.stop(),
          };
        },
      };
      return graph;
    }, next => {
      // The capture session stays active while a preview plays (see captureSession.ts).
      if (next.phase === "loading" || next.phase === "playing") {
        if (!claim) claim = claimPlayback();
      } else {
        claim?.(); claim = null;
      }
      stopTicking();
      if (next.phase === "playing") {
        tick = setInterval(() => store.setState({ positionSeconds: current.positionSeconds() }), POSITION_TICK_MS);
      }
      store.setState({ snapshot: next, positionSeconds: 0 });
    });
    player.current = current;
    const listener = AppState.addEventListener("change", next => { if (next !== "active") current.stop(); });
    return () => {
      player.current = null; listener.remove(); stopTicking();
      claim?.(); claim = null;
      void current.dispose().catch((error: unknown) => {
        console.warn("[audio-ui] closing preview AudioContext failed", error);
      });
    };
  }, [store]);
  useEffect(() => { player.current?.stop(); }, [uri, disabled]);

  const play = () => {
    if (uri) void player.current?.play(uri, durationSeconds).catch(() => undefined); // shown as "error"
  };
  return (
    <AudioPreview
      state={toPreviewViewState(state.snapshot, uri, durationSeconds, state.positionSeconds)}
      onPlay={play}
      onStop={() => player.current?.stop()}
      disabled={disabled || !uri}
      {...(peaks && peaks.length > 0 ? { peaks } : {})}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
