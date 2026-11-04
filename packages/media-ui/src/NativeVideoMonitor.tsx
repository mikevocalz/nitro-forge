import { useEffect } from "react";
import { Button, Column, Host, Text } from "@expo/ui";
import { VideoView, useVideoPlayer, type VideoSource } from "expo-video";
import { View } from "react-native";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import {
  FRAME_RATES,
  framesToSeconds,
  type FrameRate,
} from "./timebase";
import { NativeSeekBar } from "./NativeSeekBar";
import {
  reportNativePlaybackTime,
  requestVideoFrame,
  validFrameCount,
  type VideoMonitorState,
} from "./videoMonitorState";

export interface NativeVideoMonitorProps {
  /** Local or remote video source supported by Expo Video. */
  readonly source: VideoSource;
  /** Stable per-player Zustand store; Rust/Splice keeps the edit document. */
  readonly store: StoreApi<VideoMonitorState>;
  readonly frameRate?: FrameRate;
  readonly height?: number;
  readonly testID?: string;
  readonly autoplay?: boolean;
}

/**
 * Real native decoded video preview on iOS/Android, HTML video backend on web,
 * backed by Expo SDK 58's AVPlayer/Media3/browser implementations.
 *
 * Seek bar requests frame coordinates; subsequent decoder events update the
 * true reported position. Never equate requested frame with displayed frame.
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
    native.timeUpdateEventInterval = 0.1;
    native.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
    if (autoplay) native.play();
  });
  const state = useStore(store, (s) => s);
  const sourceKey = JSON.stringify(source);

  useEffect(() => {
    store.setState({
      phase: player.status === "readyToPlay"
        ? { kind: "ready", playing: player.playing }
        : { kind: "loading" },
      reportedFrame: 0,
      durationFrames: validFrameCount(player.duration, frameRate),
      bufferedFrame: 0,
      requestedFrame: null,
    });
    const time = player.addListener("timeUpdate", (payload) => {
      reportNativePlaybackTime(store, payload.currentTime, payload.bufferedPosition, frameRate);
    });
    const loaded = player.addListener("sourceLoad", (payload) => {
      store.setState({ durationFrames: validFrameCount(payload.duration, frameRate) });
    });
    const playing = player.addListener("playingChange", (payload) => {
      store.setState({ phase: { kind: "ready", playing: payload.isPlaying } });
    });
    const status = player.addListener("statusChange", (payload) => {
      if (payload.status === "error") {
        store.setState({
          phase: { kind: "error", message: payload.error?.message ?? "Video decoder failed" },
        });
      } else if (payload.status === "readyToPlay") {
        store.setState({ phase: { kind: "ready", playing: player.playing } });
      } else {
        store.setState({ phase: { kind: "loading" } });
      }
    });
    const ended = player.addListener("playToEnd", () => {
      store.setState({ phase: { kind: "ready", playing: false } });
    });
    return () => {
      time.remove();
      loaded.remove();
      playing.remove();
      status.remove();
      ended.remove();
      player.pause();
    };
  }, [player, store, frameRate.numerator, frameRate.denominator, sourceKey]);

  const requestSeek = (frame: number) => {
    if (state.phase.kind !== "ready" || state.durationFrames <= 0) return;
    const clamped = requestVideoFrame(store, frame);
    // Native decoder chooses the actually visible frame. Reported frame
    // updates only through timeUpdate after native acknowledges playback time.
    player.currentTime = framesToSeconds(clamped, frameRate);
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
          <Text>{`Decoded frame: ${state.reportedFrame} / Requested: ${state.requestedFrame ?? "—"}`}</Text>
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
