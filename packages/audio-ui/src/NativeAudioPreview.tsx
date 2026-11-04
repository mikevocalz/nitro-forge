import { useEffect, useMemo, useRef } from "react";
import { AppState, View } from "react-native";
import { Button, Column, Host, Text } from "@expo/ui";
import { AudioContext, type AudioBuffer } from "react-native-audio-api";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { ForgeAudioPlayback, type PlaybackContext, type PlaybackSnapshot } from "./audioPlayback";

/** Same React Native controls and Audio API graph on iOS, Android and web. */
export function NativeAudioPreview({ uri, durationSeconds, disabled = false }: {
  uri: string | null; durationSeconds: number; disabled?: boolean;
}) {
  const store = useMemo(() => createStore<PlaybackSnapshot>(() => ({ phase: "idle", message: "Record a clip to preview", duration: 0 })), []);
  const state = useStore(store);
  const player = useRef<ForgeAudioPlayback<AudioBuffer> | null>(null);
  useEffect(() => {
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
    }, next => store.setState(next));
    player.current = current;
    const listener = AppState.addEventListener("change", next => { if (next !== "active") current.stop(); });
    return () => { player.current = null; listener.remove(); void current.dispose().catch(() => undefined); };
  }, [store]);
  useEffect(() => { player.current?.stop(); }, [uri, disabled]);
  const active = state.phase === "playing" || state.phase === "loading";
  return <View style={{ width: "100%" }}><Host style={{ width: "100%" }}><Column spacing={8}>
    <Text>{state.message}</Text>
    <Button label={active ? "Stop preview" : "Play saved recording"} disabled={disabled || !uri}
      onPress={() => { if (active) player.current?.stop(); else if (uri) void player.current?.play(uri, durationSeconds).catch(() => undefined); }} />
  </Column></Host></View>;
}
