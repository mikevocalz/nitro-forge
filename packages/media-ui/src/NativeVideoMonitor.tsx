import { useEffect, useRef } from "react";
import { Button, Column, Host, Text } from "@expo/ui";
import { VideoView, useVideoPlayer, type VideoPlayer, type VideoSource, type VideoTrack } from "expo-video";
import { View } from "react-native";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { FRAME_RATES, type FrameRate } from "./timebase";
import { NativeSeekBar } from "./NativeSeekBar";
import {
  applyPlayingChange,
  describeFrameTimebase,
  frameSeekSeconds,
  reportNativePlaybackTime,
  requestVideoFrame,
  settleSeekRequest,
  validFrameCount,
  type VideoMonitorState,
} from "./videoMonitorState";

export interface NativeVideoMonitorProps {
  /** Local or remote video source supported by Expo Video. */
  readonly source: VideoSource;
  /** Stable per-player Zustand store; Rust/Splice keeps the edit document. */
  readonly store: StoreApi<VideoMonitorState>;
  /** Timebase for frame indices. Not read from the media track. */
  readonly frameRate?: FrameRate;
  readonly height?: number;
  readonly testID?: string;
  readonly autoplay?: boolean;
}

const TIME_UPDATE_INTERVAL_S = 0.1;
/** How long a seek may go unconfirmed before the native position is read back. */
const SEEK_SETTLE_MS = 400;

function trackRate(track: VideoTrack | null | undefined): number | null {
  const fps = track?.frameRate;
  return typeof fps === "number" && Number.isFinite(fps) && fps > 0 ? fps : null;
}

/** Reads a getter on a player that may already be released; null if it is gone. */
function readPlayer<T>(player: VideoPlayer, read: (p: VideoPlayer) => T): T | null {
  try {
    return read(player);
  } catch {
    return null;
  }
}

/**
 * Real native decoded video preview on iOS/Android, HTML video backend on web,
 * backed by Expo SDK 58's AVPlayer/Media3/browser implementations.
 *
 * The seek bar requests frame coordinates. Decoder events, or a native time
 * read after the seek settles, set the reported position. A requested frame
 * is never shown as the decoded frame.
 */
export function NativeVideoMonitor({
  source,
  store,
  frameRate = FRAME_RATES.VIDEO_30,
  height = 220,
  testID,
  autoplay = false,
}: NativeVideoMonitorProps) {
  const player = useVideoPlayer(source, (native) => {
    native.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_S;
    // Honoured by AVPlayer and Media3; the web backend ignores seekTolerance.
    native.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
    if (autoplay) native.play();
  });
  const state = useStore(store, (s) => s);
  const sourceKey = JSON.stringify(source);
  const { numerator, denominator } = frameRate;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset playback facts only when the player or its source changes.
  useEffect(() => {
    store.setState({
      phase: player.status === "readyToPlay"
        ? { kind: "ready", playing: player.playing }
        : player.status === "error"
          ? { kind: "error", message: "Video decoder failed" }
          : { kind: "loading" },
      reportedFrame: 0,
      bufferedFrame: 0,
      requestedFrame: null,
      trackFrameRate: trackRate(player.videoTrack),
    });
  }, [player, store, sourceKey]);

  // Listeners depend on the timebase; re-subscribing must not touch playback.
  useEffect(() => {
    const rate: FrameRate = { numerator, denominator };
    const windowFrames = Math.ceil(TIME_UPDATE_INTERVAL_S * numerator / denominator) + 1;
    const current = readPlayer(player, (p) => p.currentTime);
    store.setState({ durationFrames: validFrameCount(player.duration, rate) });
    if (current !== null) reportNativePlaybackTime(store, current, player.bufferedPosition, rate);
    const subs = [
      player.addListener("timeUpdate", (payload) => {
        reportNativePlaybackTime(store, payload.currentTime, payload.bufferedPosition, rate, windowFrames);
      }),
      player.addListener("sourceLoad", (payload) => {
        store.setState({
          durationFrames: validFrameCount(payload.duration, rate),
          trackFrameRate: trackRate(payload.availableVideoTracks[0]) ?? store.getState().trackFrameRate,
        });
      }),
      player.addListener("videoTrackChange", (payload) => {
        store.setState({ trackFrameRate: trackRate(payload.videoTrack) });
      }),
      player.addListener("playingChange", (payload) => {
        store.setState({ phase: applyPlayingChange(store.getState().phase, payload.isPlaying) });
      }),
      player.addListener("statusChange", (payload) => {
        if (payload.status === "error") {
          store.setState({
            phase: { kind: "error", message: payload.error?.message ?? "Video decoder failed" },
          });
        } else if (payload.status === "readyToPlay") {
          store.setState({ phase: { kind: "ready", playing: player.playing } });
        } else {
          store.setState({ phase: { kind: "loading" } });
        }
      }),
      player.addListener("playToEnd", () => {
        store.setState({ phase: applyPlayingChange(store.getState().phase, false) });
      }),
    ];
    return () => {
      for (const sub of subs) sub.remove();
    };
  }, [player, store, numerator, denominator]);

  // Pause only when this player goes away, never on a timebase change.
  useEffect(() => () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    readPlayer(player, (p) => p.pause());
  }, [player]);

  const requestSeek = (frame: number) => {
    if (state.phase.kind !== "ready" || state.durationFrames <= 0) return;
    const clamped = requestVideoFrame(store, frame);
    const lastFrame = Math.max(0, state.durationFrames - 1);
    // Aim at the frame centre so float error cannot land on the previous frame.
    player.currentTime = frameSeekSeconds(Math.min(clamped, lastFrame), frameRate);
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      const seconds = readPlayer(player, (p) => p.currentTime);
      if (seconds !== null) settleSeekRequest(store, clamped, seconds, frameRate);
    }, SEEK_SETTLE_MS);
  };
  const statusText = state.phase.kind === "error"
    ? state.phase.message
    : state.phase.kind === "loading"
      ? "Loading video"
      : state.phase.playing ? "Playing" : "Paused";
  const frame = state.requestedFrame ?? state.reportedFrame;
  const canControl = state.phase.kind === "ready" && state.durationFrames > 0;

  return (
    <View testID={testID} style={{ width: "100%", gap: 12 }}>
      <VideoView player={player} nativeControls={false} playsInline
        contentFit="contain" style={{ width: "100%", height, backgroundColor: "#09090B" }}
        {...(testID ? { testID: testID + "-video" } : {})}
      />
      <NativeSeekBar
        frame={frame}
        durationFrames={state.durationFrames}
        frameRate={frameRate}
        onSeek={requestSeek}
        disabled={!canControl}
        {...(testID ? { testID: testID + "-seek" } : {})}
      />
      <Host style={{ width: "100%" }}>
        <Column spacing={8}>
          <Text>{statusText}</Text>
          <Text>{`Reported frame: ${state.reportedFrame} / Requested: ${state.requestedFrame ?? "—"}`}</Text>
          <Text>{describeFrameTimebase(frameRate, state.trackFrameRate)}</Text>
          <Button
            label={state.phase.kind === "ready" && state.phase.playing ? "Pause" : "Play"}
            disabled={!canControl}
            onPress={() => {
              if (!canControl) return;
              if (player.playing) player.pause();
              else player.play();
            }}
          />
        </Column>
      </Host>
    </View>
  );
}
