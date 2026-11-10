import { useEffect, useRef } from "react";
import { ScrollView, Text } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

/** Status for this app's opt-in native acceptance workflows. */
export function AcceptanceScreen({ run }: { run: () => Promise<string> }) {
  const ref = useRef<StoreApi<{ result: string }> | null>(null);
  if (!ref.current) ref.current = createStore(() => ({ result: "Running native acceptance…" }));
  const store = ref.current;
  const result = useStore(store, state => state.result);
  useEffect(() => {
    let cancelled = false;
    void run().then(result => {
      console.info(result);
      if (!cancelled) store.setState({ result });
    }, error => {
      console.error(error);
      if (!cancelled) store.setState({ result: String(error) });
    });
    return () => { cancelled = true; };
  }, [run, store]);
  return <ScrollView contentContainerStyle={{ padding: 24 }}>
    <Text accessibilityLiveRegion="polite" selectable>{result}</Text>
  </ScrollView>;
}
