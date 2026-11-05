import { useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { ArcKnob } from "@nyc-tron/native-controls/ArcKnob";
import { CadenceInstrumentSession, type CadenceInstrumentState } from "@nitro-forge/cadence/instrument-session";
import { createNitroHost } from "@nitro-forge/ignition";

type ScreenState = {
  phase: "loading" | "ready" | "error";
  actual: Readonly<CadenceInstrumentState> | null;
  error: string | null;
  pending: boolean;
  width: number;
  attempt: number;
  savedBytes: number | null;
  gainPreview: number | null;
  panPreview: number | null;
};
const initial: ScreenState = {
  phase: "loading", actual: null, error: null, pending: false,
  width: 360, attempt: 0, savedBytes: null, gainPreview: null, panPreview: null,
};
const colors = {
  background: "#101017", surface: "#1B1B25", text: "#F7F7FA",
  muted: "#AAAABB", accent: "#B2A7FF", danger: "#FB7185", border: "#48485C",
};

/**
 * Genuine SwiftUI/Compose consumer. Uses the actual Cadence Rust document.
 * An unavailable native Nitro factory is an error, NOT an invitation to mock.
 */
export default function App() {
  const localRef = useRef<StoreApi<ScreenState> | null>(null);
  if (!localRef.current) localRef.current = createStore<ScreenState>(() => ({ ...initial }));
  const store = localRef.current;
  const state = useStore(store, (s) => s);
  const currentSession = useRef<CadenceInstrumentSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    store.setState({ phase: "loading", actual: null, error: null,
      gainPreview: null, panPreview: null, savedBytes: null });
    const connect = async () => {
      try {
        const host = createNitroHost();
        const session = await CadenceInstrumentSession.open(host, {
          trackName: "Native instrument 01",
        });
        if (cancelled) { await session.close(); return; }
        currentSession.current = session;
        unsubscribe = session.subscribe((actual) => {
          if (!cancelled) store.setState({
            actual, phase: "ready", error: null,
            gainPreview: null, panPreview: null,
          });
        });
        store.setState({ actual: session.state, phase: "ready" });
      } catch (error) {
        if (!cancelled) store.setState({
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void connect();
    return () => {
      cancelled = true;
      unsubscribe?.();
      const session = currentSession.current;
      currentSession.current = null;
      if (session) void session.close();
    };
  }, [state.attempt, store]);

  const execute = async (run: (session: CadenceInstrumentSession) => Promise<unknown>) => {
    const session = currentSession.current;
    if (!session || store.getState().pending) return;
    store.setState({ pending: true, error: null });
    try {
      await run(session);
    } catch (error) {
      store.setState({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      store.setState({ pending: false, gainPreview: null, panPreview: null });
    }
  };
  const action = (run: (session: CadenceInstrumentSession) => Promise<unknown>) => {
    void execute(run).catch(() => undefined); // Error already displayed.
  };

  const actual = state.actual;
  const size = Math.min(164, Math.max(104, Math.floor((state.width - 72) / 2)));
  const enabled = state.phase === "ready" && !state.pending;
  return <ScrollView
    accessibilityLabel="Cadence native instrument editor"
    style={{ flex: 1, backgroundColor: colors.background }}
    contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 30, gap: 18 }}
    onLayout={event => {
      const width = event.nativeEvent.layout.width;
      if (Number.isFinite(width) && width > 0 && width !== store.getState().width)
        store.setState({ width });
    }}>
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 28 }}>Cadence / Native</Text>
      <Text style={{ color: colors.muted }}>SwiftUI · Jetpack Compose · Rust-owned document</Text>
    </View>
    {state.phase === "loading"
      ? <ActivityIndicator accessibilityLabel="Connecting to Cadence" color={colors.accent}/>
      : null}
    {state.phase === "error"
      ? <View style={{ padding: 16, borderRadius: 12, backgroundColor: colors.surface,
          borderWidth: 1, borderColor: colors.danger, gap: 12 }}>
          <Text style={{ color: colors.danger, fontWeight: "700" }}>Native engine unavailable</Text>
          <Text selectable style={{ color: colors.text }}>{state.error}</Text>
          <Text style={{ color: colors.muted }}>
            Real Nitro Forge v1 registration is required. This screen never creates a fake document.
          </Text>
          <Action label="Retry connection" onPress={() =>
            store.setState(s => ({ attempt: s.attempt + 1 }))}/>
        </View>
      : null}
    {state.phase === "ready" && actual
      ? <View style={{ gap: 16 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap",
            alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <ArcKnob label="Gain" value={actual.gain} minimum={0} maximum={1}
              step={0.01} enabled={enabled} size={size}
              accentColor={colors.accent} textColor={colors.text}
              onPreview={gainPreview => store.setState({ gainPreview })}
              onCommit={value => execute(s => s.setGain(value))}
              onError={error => store.setState({
                error: error instanceof Error ? error.message : String(error),
              })}/>
            <ArcKnob label="Pan" value={actual.pan} minimum={-1} maximum={1}
              step={0.01} enabled={enabled} size={size}
              accentColor={colors.accent} textColor={colors.text}
              onPreview={panPreview => store.setState({ panPreview })}
              onCommit={value => execute(s => s.setPan(value))}
              onError={error => store.setState({
                error: error instanceof Error ? error.message : String(error),
              })}/>
          </View>
          <View style={{ backgroundColor: colors.surface, borderWidth: 1,
            borderColor: colors.border, borderRadius: 12, padding: 14, gap: 4 }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>{actual.trackName}</Text>
            <Text style={{ color: colors.muted }}>
              Gain {actual.gain.toFixed(2)} · Pan {actual.pan.toFixed(2)} · {actual.tempoBpm} BPM
            </Text>
            {state.gainPreview !== null || state.panPreview !== null
              ? <Text style={{ color: colors.accent }}>
                  Preview (not saved): {String(state.gainPreview ?? actual.gain)}
                  {" / "}{String(state.panPreview ?? actual.pan)}
                </Text> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Action label="Undo" disabled={state.pending} onPress={() => action(s => s.undo())}/>
            <Action label="Redo" disabled={state.pending} onPress={() => action(s => s.redo())}/>
            <Action label="Snapshot" disabled={state.pending} onPress={() =>
              action(async s => {
                const bytes = await s.save();
                store.setState({ savedBytes: bytes.byteLength });
              })}/>
          </View>
          {state.savedBytes !== null
            ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
                NFD1 snapshot: {state.savedBytes} bytes. Not saved to device storage.
              </Text> : null}
        </View>
      : null}
    {state.error && state.phase === "ready"
      ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>
          {state.error}
        </Text> : null}
  </ScrollView>;
}
function Action({ label, disabled = false, onPress }: {
  label: string; disabled?: boolean; onPress: () => void;
}) {
  return <Pressable
    accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({
      minHeight: 48, minWidth: 94, paddingHorizontal: 14, borderWidth: 1,
      borderColor: colors.border, borderRadius: 9, backgroundColor: colors.surface,
      justifyContent: "center", alignItems: "center",
      opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
    })}>
    <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
  </Pressable>;
}
