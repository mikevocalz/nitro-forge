import { useEffect, useRef } from "react";
import { ScrollView, Text } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { verifyNativeCheckpoints } from "./verify-checkpoints";

export default function CheckpointAcceptance() {
  const ref = useRef<StoreApi<{ result: string }> | null>(null);
  if (!ref.current) ref.current = createStore(() => ({ result: "Verifying persistent native checkpoints…" }));
  const store = ref.current;
  const result = useStore(store, state => state.result);
  useEffect(() => {
    let cancelled = false;
    void verifyNativeCheckpoints().then(result => {
      console.info(result);
      if (!cancelled) store.setState({ result });
    }, error => {
      console.error(error);
      if (!cancelled) store.setState({ result: String(error) });
    });
    return () => { cancelled = true; };
  }, [store]);
  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Text accessibilityLiveRegion="polite" selectable>{result}</Text>
  </ScrollView>;
}
