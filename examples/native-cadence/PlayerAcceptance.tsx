import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { File, Paths } from "expo-file-system";
import { VideoPlayer, VideoView, type onLoadData, type onProgressData } from "react-native-video";

type State = { mounted: boolean; generation: number; continueReady: boolean; result: string };
function waitFor<T>(subscribe: (receive: (value: T) => void) => { remove(): void },
  accept: (value: T) => boolean, signal: AbortSignal, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: { remove(): void } | undefined;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); subscription?.remove(); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(Error("Player verification cancelled"));
    const timeout = setTimeout(() => finish(Error("Native player event timed out")), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    subscription = subscribe(value => { if (accept(value)) finish(undefined, value); });
    if (settled) subscription.remove();
  });
}

/** Real native acceptance; its explicit pause permits a screenshot before teardown. */
export default function PlayerAcceptance() {
  const local = useRef<StoreApi<State> | null>(null);
  local.current ??= createStore<State>(() => ({ mounted: false, generation: 0, continueReady: false, result: "Opening selected native player…" }));
  const store = local.current;
  const state = useStore(store, value => value);
  const owner = useRef<VideoPlayer | null>(null);
  const continueRun = useRef<(() => void) | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let player: VideoPlayer | null = null;
    const run = async () => {
      const evidence: string[] = [];
      try {
        const fixture = new File(Paths.cache, "P03-decoder.mp4");
        if (!fixture.exists) throw Error("Generated media fixture is missing");
        for (let cycle = 0; cycle < 3; cycle++) {
          if (abort.signal.aborted) return;
          player = new VideoPlayer({ uri: fixture.uri, initializeOnCreation: false });
          owner.current = player;
          await player.configure({ muted: true, loop: false });
          const load = waitFor<onLoadData>(receive => player!.addEventListener("onLoad", receive), () => true, abort.signal);
          const ready = waitFor<void>(receive => player!.addEventListener("onReadyToDisplay", receive), () => true, abort.signal);
          store.setState({ mounted: true, generation: cycle, result: `Native cycle ${cycle + 1}/3 loading…` });
          const [metadata] = await Promise.all([load, ready, player.initialize()]);
          if (metadata.width !== 192 || metadata.height !== 128) throw Error(`Native dimensions ${metadata.width}x${metadata.height}`);
          if (!player.muted) throw Error("Initialization lost configured mute");
          const progress = waitFor<onProgressData>(receive => player!.addEventListener("onProgress", receive), value => value.currentTime > .2, abort.signal);
          await player.play();
          const position = await progress;
          await player.pause();
          const seek = waitFor<number>(receive => player!.addEventListener("onSeek", receive), value => Math.abs(value - .75) < .06, abort.signal);
          await player.seekTo(.75);
          const sought = await seek;
          evidence.push(`cycle ${cycle + 1}: 192x128, native progress ${position.currentTime.toFixed(3)}s, reported seek ${sought.toFixed(3)}s`);
          if (cycle === 0) {
            store.setState({ continueReady: true, result: "Paused native Fabric video at reported 0.750s. Capture the rendered frame, then continue the replacement and release checks." });
            await waitFor<void>(receive => {
              continueRun.current = receive;
              return { remove() { continueRun.current = null; } };
            }, () => true, abort.signal, 120000);
            store.setState({ continueReady: false });
          }
          const replaced = waitFor<onLoadData>(receive => player!.addEventListener("onLoad", receive), value => value.width === 192 && value.height === 128, abort.signal);
          await Promise.all([replaced, player.replaceSourceAsync({ uri: fixture.uri, initializeOnCreation: false })]);
          if (!player.muted) throw Error("Replacement lost configured mute");
          evidence.push(`cycle ${cycle + 1}: source replacement loaded`);
          owner.current = null;
          store.setState({ mounted: false });
          player.release();
          player.release();
          let deadline: ReturnType<typeof setTimeout> | undefined;
          const rejected = await Promise.race([
            player.initialize().then(() => false, () => true),
            new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error("Released-player initialization did not settle")), 3000); }),
          ]).finally(() => clearTimeout(deadline));
          if (!rejected) throw Error("Released player accepted initialization");
          evidence.push(`cycle ${cycle + 1}: repeated release safe; initialization rejects`);
        }
        if (abort.signal.aborted) return;
        console.info("[player-acceptance]", JSON.stringify(evidence));
        store.setState({ result: `Native selected player passed three mount/play/pause/seek/replace/release cycles. ${evidence.join("; ")}. Decoder pixel/frame accuracy is a separate check.` });
      } catch (error) {
        if (!abort.signal.aborted) store.setState({ continueReady: false, result: `Error: ${error instanceof Error ? error.message : String(error)}` });
      }
    };
    void run();
    return () => { abort.abort(); continueRun.current = null; owner.current = null; player?.release(); };
  }, [store]);
  return <ScrollView style={{ flex: 1, backgroundColor: "#101017" }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Text accessibilityLiveRegion="polite" style={{ color: "white" }}>{state.result}</Text>
    {state.mounted && owner.current ? <VideoView key={state.generation} player={owner.current} controls={false} resizeMode="contain" style={{ width: "100%", height: 240 }}/> : null}
    {state.continueReady ? <Pressable accessibilityRole="button" accessibilityLabel="Continue native lifecycle verification" onPress={() => continueRun.current?.()} style={{ padding: 16, backgroundColor: "#344269" }}><Text style={{ color: "white" }}>Continue native lifecycle verification</Text></Pressable> : null}
  </ScrollView>;
}
