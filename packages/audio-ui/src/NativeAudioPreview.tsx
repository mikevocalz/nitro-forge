import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { AudioContext, type AudioBuffer } from "react-native-audio-api";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { AudioPreview } from "@nyc-tron/ui/components/forge/audio/AudioPreview";
import type { WaveformPeak } from "@nitro-forge/media-ui";
import { ForgeAudioPlayback, type PlaybackContext, type PlaybackSnapshot } from "./audioPlayback";
import { createPlatformPlaybackSession } from "@nyc-tron/platform-services/playback";
import { registerPlaybackSession } from "./playbackSessions";
import { releasePreviewSession } from "./captureSession";
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
  const startPreview = useRef<((uri: string, duration: number) => Promise<void>) | null>(null);
  useEffect(() => {
    let generation = 0;
    let startingGraph = false;
    let sessionWork: Promise<unknown> = Promise.resolve();
    const playbackSession = createPlatformPlaybackSession({
      // Audition has Stop rather than Pause/Resume. Interruptions, output loss
      // and media resets stop it; restarting always requires a new press.
      onAction: action => {
        if (action !== "resume" && action !== "unduck") current.stop();
      },
    });
    const unregister = registerPlaybackSession(playbackSession);
    const releaseSession = () => { sessionWork = sessionWork.then(() => releasePreviewSession(playbackSession)).catch((error: unknown) => {
      console.warn("[audio-ui] releasing preview session failed", error);
    }); };
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
      if (startingGraph && next.phase === "stopped") return;
      if (next.phase === "loading" || next.phase === "playing") {
        playbackSession.setIntent("playing");
      } else {
        generation++;
        playbackSession.setIntent("paused");
        releaseSession();
      }
      stopTicking();
      if (next.phase === "playing") {
        tick = setInterval(() => store.setState({ positionSeconds: current.positionSeconds() }), POSITION_TICK_MS);
      }
      store.setState({ snapshot: next, positionSeconds: 0 });
    });
    player.current = current;
    startPreview.current = async (nextUri, duration) => {
      startingGraph = true;
      current.stop();
      startingGraph = false;
      stopTicking();
      const ticket = ++generation;
      playbackSession.setIntent("playing");
      try {
        if (playbackSession.isAvailable) {
          sessionWork = sessionWork.catch(() => undefined).then(async () => {
            if (ticket !== generation) return;
            if (!await playbackSession.activate({ category: "playback" })) {
              throw new Error("The system did not grant audio playback");
            }
          });
          await sessionWork;
        }
        if (ticket !== generation) { releaseSession(); return; }
        startingGraph = true;
        const playing = current.play(nextUri, duration);
        startingGraph = false;
        await playing;
      } catch (error) {
        startingGraph = false;
        if (ticket === generation) {
          playbackSession.setIntent("paused");
          releaseSession();
          store.setState({ snapshot: { phase: "error", message: error instanceof Error ? error.message : "Playback failed", duration: 0 } });
        }
      }
    };
    const listener = AppState.addEventListener("change", next => { if (next !== "active") current.stop(); });
    return () => {
      generation++;
      startPreview.current = null;
      player.current = null; listener.remove(); stopTicking();
      // Stop the graph before releasing OS focus or notifying capture waiters.
      current.stop();
      playbackSession.setIntent("paused");
      unregister(); playbackSession.dispose();
      releaseSession();
      void current.dispose().catch((error: unknown) => {
        console.warn("[audio-ui] closing preview AudioContext failed", error);
      });
    };
  }, [store]);
  useEffect(() => { player.current?.stop(); }, [uri, disabled]);

  const play = () => {
    if (uri) void startPreview.current?.(uri, durationSeconds);
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
