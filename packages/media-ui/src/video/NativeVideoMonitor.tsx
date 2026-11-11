import { useLayoutEffect, useMemo, useImperativeHandle, useRef, forwardRef } from "react";
import { Image, Text, View, Platform } from "react-native";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { VideoPlayer, VideoView } from "react-native-video";
import { createPlatformMediaDecoder } from "@nyc-tron/platform-services/media";
import { NativeSeekBar } from "@nyc-tron/ui/components/forge/NativeSeekBar";
import { TransportControls } from "@nyc-tron/ui/components/forge/timeline/TransportControls";
import type { FrameRate } from "../timebase";
import { createFrameSession, createVideoMonitorStore, indexAtTime, presentationIndex, type FrameSession, type FrameResult, type VideoMonitorState } from "./frameSession";

export interface NativeVideoMonitorProps {
  /** A local file or granted content URI. Import remote media before editing it. */
  readonly uri: string;
  /** Source/container presentation timestamps. Omit to request the linked decoder's optional v1 index; alpha.4 binaries require explicit timestamps. */
  readonly presentationTimesUs?: readonly number[];
  /** Timecode labels for frame indices; seeks always use presentationTimesUs. */
  readonly displayFrameRate: FrameRate;
  readonly store?: StoreApi<VideoMonitorState>;
  readonly height?: number;
  readonly testID?: string;
  /** Configuration for source opening, not reactive playback state. */
  readonly options?: Parameters<VideoPlayer["configure"]>[0];
}
export interface NativeVideoMonitorHandle {
  play(): Promise<void>;
  pause(): Promise<void>;
  commitFrame(index: number): Promise<FrameResult>;
}
interface Source { readonly uri: string; readonly times: readonly number[] | undefined; readonly store: StoreApi<VideoMonitorState> }
interface Owner { readonly player: VideoPlayer; readonly session: FrameSession; readonly source: Source; intent: number; run<T>(action: () => Promise<T>): Promise<T> }

/** Editor adapter for the selected Nitro v1 player and real local decoder. */
export const NativeVideoMonitor = forwardRef<NativeVideoMonitorHandle, NativeVideoMonitorProps>(function NativeVideoMonitor(
  { uri, presentationTimesUs, displayFrameRate, store: provided, height = 220, testID, options }, ref,
) {
  const local = useRef<StoreApi<VideoMonitorState> | null>(null);
  if (!local.current) local.current = createVideoMonitorStore();
  const store = provided ?? local.current;
  const state = useStore(store, value => value);
  const owner = useRef<Owner | null>(null);
  const indexSequence = useRef(0);
  const source = useMemo<Source>(() => ({ uri, times: presentationTimesUs, store }), [uri, presentationTimesUs, store]);
  const committedSource = useRef<Source | null>(null);
  const initialOptions = useRef(options);
  initialOptions.current = options;
  useLayoutEffect(() => {
    committedSource.current = source;
    let disposed = false, released = false;
    const indexCancellation = new AbortController();
    const indexToken = ++indexSequence.current;
    let resource: Owner | null = null;
    let player: VideoPlayer | null = null;
    const live = () => !disposed && !released && committedSource.current === source;
    let transportTail: Promise<void> = Promise.resolve();
    const run = <T,>(action: () => Promise<T>): Promise<T> => {
      const task = transportTail.then(async () => {
        if (!live() || !resource || owner.current !== resource) throw Error("The video source changed before transport admission");
        const result = await action();
        if (!live() || owner.current !== resource) throw Error("The video source changed during the transport action");
        return result;
      });
      transportTail = task.then(() => undefined, () => undefined);
      return task;
    };
    const release = () => {
      if (released) return;
      released = true;
      indexCancellation.abort();
      if (owner.current === resource) owner.current = null;
      resource?.session.close();
      player?.release();
    };
    store.setState({ status: "loading", playing: false, playbackTimeUs: 0, bufferedTimeUs: 0, durationUs: 0, decoded: null, requestedIndex: null, pendingIndexToken: indexToken, error: null });
    const open = async () => {
      try {
        if (!live() || store.getState().pendingIndexToken !== indexToken) return;
        if (Platform.OS === "web") throw Error("Indexed native video monitoring is not available on web in this build");
        const decoder = createPlatformMediaDecoder();
        if (!decoder.isAvailable) throw Error("The native media decoder is not linked in this build");
        // Structural extension keeps this source compatible with released alpha.4 types.
        const indexed = decoder as typeof decoder & {
          readonly presentationIndexVersion?: 1;
          presentationIndex?(sourceUri: string, options: { readonly signal: AbortSignal }): Promise<{
            readonly durationUs: number; readonly timesUs: readonly number[];
          }>;
        };
        let timesUs: readonly number[];
        let indexedDurationUs: number | undefined;
        if (presentationTimesUs !== undefined) timesUs = presentationIndex(presentationTimesUs);
        else {
          if (indexed.presentationIndexVersion !== 1 || typeof indexed.presentationIndex !== "function")
            throw Error("This build has no v1 presentation index. Supply actual presentationTimesUs or link the new native decoder source candidate.");
          const index = await indexed.presentationIndex(uri, { signal: indexCancellation.signal });
          if (!live() || store.getState().pendingIndexToken !== indexToken) return;
          if (!Number.isSafeInteger(index.durationUs) || index.durationUs <= 0) throw Error("The decoder returned an invalid index duration");
          timesUs = presentationIndex(index.timesUs);
          if (timesUs.at(-1)! >= index.durationUs) throw Error("Presentation index exceeds its source duration");
          indexedDurationUs = index.durationUs;
        }
        if (!live() || store.getState().pendingIndexToken !== indexToken) return;
        // No player is allocated while the cancellable index lookup is pending.
        player = new VideoPlayer({ uri, initializeOnCreation: false });
        const ownedPlayer = player;
        const session = createFrameSession({ uri, timesUs, decoder,
          transport: { pause: () => run(() => ownedPlayer.pause()), seekTo: seconds => run(() => ownedPlayer.seekTo(seconds)) }, store });
        resource = { player, session, source, run, intent: 0 };
        owner.current = resource;
        player.addEventListener("onPlaybackStateChange", value => { if (live() && (!value.isPlaying || store.getState().requestedIndex === null)) store.setState({ playing: value.isPlaying }); });
        player.addEventListener("onProgress", value => {
          if (live()) store.setState({ playbackTimeUs: Math.round(value.currentTime * 1_000_000), bufferedTimeUs: Math.round((value.currentTime + value.bufferDuration) * 1_000_000) });
        });
        player.addEventListener("onError", error => {
          if (!live()) return;
          release();
          if (committedSource.current === source) store.setState({ status: "error", playing: false, pendingIndexToken: null, error: error.message });
        });
        await player.configure(initialOptions.current ?? {});
        if (!live()) return;
        const [probe] = await Promise.all([decoder.probe(uri), player.initialize()]);
        if (!live()) return;
        if (!probe.video || session.timesUs.at(-1)! >= probe.durationUs ||
          (indexedDurationUs !== undefined && indexedDurationUs !== probe.durationUs)) throw Error("Presentation index exceeds the source video");
        store.setState({ durationUs: probe.durationUs, pendingIndexToken: null });
        await session.commit(0);
      } catch (error) {
        if (live()) {
          release();
          if (committedSource.current === source) store.setState({ status: "error", playing: false, pendingIndexToken: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    void open();
    return () => {
      disposed = true;
      if (committedSource.current === source) committedSource.current = null;
      release();
      if (store.getState().pendingIndexToken === indexToken) store.setState({ pendingIndexToken: null });
    };
  }, [source, uri, presentationTimesUs, store]);
  const requireOwner = (allowFrameError = false) => {
    const status = store.getState().status;
    if (committedSource.current !== source || owner.current?.source !== source ||
      (status !== "ready" && !(allowFrameError && status === "error"))) throw Error("The video monitor is not ready");
    return owner.current;
  };
  type Admission = { owner: Owner; intent: number };
  const pause = async (admission?: Admission) => {
    const current = admission?.owner ?? requireOwner();
    const intent = admission?.intent ?? ++current.intent;
    await current.run(async () => { if (current.intent === intent) await current.player.pause(); });
    if (current.intent !== intent) return;
    await current.session.commit(indexAtTime(current.session.timesUs, Math.round(current.player.currentTime * 1_000_000)));
  };
  const play = async (admission?: Admission) => {
    const current = admission?.owner ?? requireOwner();
    if (store.getState().requestedIndex !== null) throw Error("Wait for the requested frame before playing");
    const intent = admission?.intent ?? ++current.intent;
    await current.run(async () => {
      if (current.intent !== intent) return;
      if (store.getState().requestedIndex !== null) throw Error("Wait for the requested frame before playing");
      await current.player.play();
    });
  };
  useImperativeHandle(ref, () => ({ play: () => play(), pause: () => pause(), commitFrame: async index => {
    const current = requireOwner(true);
    if (!Number.isInteger(index) || index < 0 || index >= current.session.timesUs.length) throw RangeError("Frame index is out of range");
    ++current.intent;
    return current.session.commit(index);
  } }));
  const perform = (action: (admission: Admission) => Promise<unknown>) => {
    const expected = owner.current;
    const admitted = expected && expected.source === source && committedSource.current === source;
    const intent = admitted ? ++expected.intent : -1;
    const task = Promise.resolve().then(() => {
      if (!admitted || !expected || expected.source !== source || owner.current !== expected || committedSource.current !== source)
        throw Error("The video source changed before this action began");
      if (expected.intent !== intent) return;
      return action({ owner: expected, intent });
    }).catch(error => {
      if (expected && expected.intent === intent && owner.current === expected && committedSource.current === source)
        store.setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    });
    // Transport callbacks may be void; seek controls still receive the original rejection.
    void task.catch(() => {});
    return task;
  };
  const resource = owner.current?.source === source ? owner.current : null;
  const visible = committedSource.current === source ? state : { ...state, status: "loading" as const, playing: false, decoded: null, error: null };
  const canSeek = !!resource && (state.status === "ready" || state.status === "error");
  const transportBlocked = visible.status !== "ready" || state.requestedIndex !== null;
  const timesUs = resource?.session.timesUs ?? presentationTimesUs ?? [];
  const count = timesUs.length;
  const shown = visible.playing ? indexAtTime(timesUs, state.playbackTimeUs) : visible.decoded?.index ?? 0;
  return <View testID={testID} style={{ gap: 8 }}>
    <View style={{ height }}>
      {resource ? <VideoView player={resource.player} controls={false} resizeMode="contain" style={{ width: "100%", height: "100%" }}/> : null}
      {!visible.playing && visible.decoded ? <Image source={{ uri: visible.decoded.frame.uri }} resizeMode="contain"
        accessibilityLabel={`Decoded frame ${visible.decoded.index} at ${visible.decoded.frame.actualTimeUs} microseconds`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}/> : null}
    </View>
    <Text accessibilityLiveRegion="polite">{visible.error ?? (visible.status === "loading" ? "Loading video" : visible.decoded ? `Decoded frame ${visible.decoded.index}, presentation ${visible.decoded.frame.actualTimeUs} µs` : "Video ready")}</Text>
    <NativeSeekBar frame={shown} durationFrames={Math.max(0, count - 1)} frameRate={displayFrameRate} disabled={!canSeek}
      onPreview={index => perform(() => requireOwner(true).session.preview(index))} onCommit={index => perform(() => requireOwner(true).session.commit(index))}/>
    <TransportControls playing={visible.playing} frame={shown} durationFrames={Math.max(0, count - 1)}
      {...(transportBlocked ? { disabledReason: visible.error ?? (state.requestedIndex !== null ? "Loading frame" : "Loading video") } : {})}
      onPlayPause={() => perform(admission => store.getState().playing ? pause(admission) : play(admission))} onStop={() => perform(() => requireOwner().session.commit(0))}
      onSeek={index => perform(() => requireOwner(true).session.commit(index))}/>
  </View>;
});
