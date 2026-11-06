import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { ArcKnob } from "@nyc-tron/native-controls/ArcKnob";
import { InstrumentKnob } from "@nyc-tron/ui/components/forge/inputs/InstrumentKnob";
import { InstrumentXYPad } from "@nyc-tron/ui/components/forge/inputs/InstrumentXYPad";
import { CadenceInstrumentSession, type CadenceInstrumentState } from "@nitro-forge/cadence/instrument-session";
import { createNitroHost, type EngineHost } from "@nitro-forge/ignition";
import { createTelemetry, instrumentHost, type Telemetry } from "@nitro-forge/telemetry";
import { SegmentedControl } from "@nyc-tron/ui/components/SegmentedControl";
import { createKeyboardMap } from "@nyc-tron/ui/components/shell/keyboard-map";
import { useHardwareKeyboard, isHardwareKeysAvailable } from "@nyc-tron/hardware-keys";
import { shareDiagnosticTrace } from "./verify-documents";
import { verifyNativeEngines } from "./verify-engines";
import { verifyNativeServices } from "./verify-services";
import { verifyNativeTelemetry } from "./verify-telemetry";
import { verifyPickerCancellation, shareTestSnapshot, importTestSnapshot,
  retainTestBookmark, restoreTestBookmark, verifyMissingFixture } from "./verify-documents";

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
  verification: string | null;
  consent: "off" | "local";
  diagnosticEvents: number;
  lastShortcut: string | null;
  /** NYC-Tron instrument renderer. All share the same authoritative Cadence session. */
  renderer: "native" | "react-native" | "xy";
};
const initial: ScreenState = {
  phase: "loading", actual: null, error: null, pending: false,
  width: 360, attempt: 0, savedBytes: null, gainPreview: null, panPreview: null,
  renderer: "native",
  verification: null, consent: "off", diagnosticEvents: 0, lastShortcut: null,
};
const colors = {
  background: "#101017", surface: "#1B1B25", text: "#F7F7FA",
  muted: "#AAAABB", accent: "#B2A7FF", danger: "#FB7185", border: "#48485C", paper: "#F7F7FA",
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
  const telemetryRef = useRef<Telemetry | null>(null);
  if (!telemetryRef.current) telemetryRef.current = createTelemetry({ consent: "off", maxEvents: 200 });
  const telemetry = telemetryRef.current;
  useEffect(() => () => telemetry.setConsent("off"), [telemetry]);
  const keyboard = useRef<ReturnType<typeof createKeyboardMap> | null>(null);
  if (!keyboard.current) keyboard.current = createKeyboardMap([
    { id: "gain-down", label: "Decrease gain", binding: "F6" },
    { id: "undo", label: "Undo", binding: "F7" },
    { id: "redo", label: "Redo", binding: "F8" },
    { id: "undo-standard", label: "Undo", binding: "Mod+Z" },
    { id: "redo-standard", label: "Redo", binding: "Mod+Shift+Z" },
  ], Platform.OS === "ios");
  useHardwareKeyboard({ map: keyboard.current, enabled: state.phase === "ready" && !state.pending,
    onCommand: entry => {
      store.setState({ lastShortcut: entry.label });
      if (entry.id === "gain-down") action(s => s.setGain(Math.max(0, s.state.gain - .1)));
      else if (entry.id.startsWith("undo")) action(s => s.undo());
      else action(s => s.redo());
    } });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let host: EngineHost | undefined;
    store.setState({ phase: "loading", actual: null, error: null,
      gainPreview: null, panPreview: null, savedBytes: null, verification: null });
    const connect = async () => {
      try {
        host = instrumentHost(createNitroHost(), telemetry);
        const session = await CadenceInstrumentSession.open(host, {
          trackName: "Native instrument 01",
        });
        if (cancelled) {
          try { await session.close(); } finally { await host.dispose(); }
          return;
        }
        currentSession.current = session;
        unsubscribe = session.subscribe((actual) => {
          if (!cancelled) store.setState({
            actual, phase: "ready", error: null,
            gainPreview: null, panPreview: null,
          });
        });
        store.setState({ actual: session.state, phase: "ready" });
      } catch (error) {
        // Opening can allocate native documents before initialization fails.
        // Dispose even when no session was published to the screen.
        await host?.dispose().catch(cleanupError => console.error("Cadence cleanup failed", cleanupError));
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
      void (async () => {
        try { await session?.close(); } finally { await host?.dispose(); }
      })().catch(error => console.error("Cadence cleanup failed", error));
    };
  }, [state.attempt, store, telemetry]);

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
      store.setState({ pending: false, gainPreview: null, panPreview: null,
        diagnosticEvents: telemetry.exportTrace().events.length });
    }
  };
  const action = (run: (session: CadenceInstrumentSession) => Promise<unknown>) => {
    void execute(run).catch(() => undefined); // Error already displayed.
  };

  const actual = state.actual;
  const session = currentSession.current;
  const reportError = (error: unknown) => store.setState({
    error: error instanceof Error ? error.message : String(error),
  });
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
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>Diagnostics: {state.consent === "off" ? "off" : "local only"}</Text>
      <Text style={{ color: colors.muted }}>Local mode keeps up to 200 events in memory. Nothing uploads automatically. Off clears the trace.</Text>
      <SegmentedControl unstyled aria-label="Diagnostic consent" value={state.consent}
        options={[{value:"off",label:"Off"},{value:"local",label:"Local only"}]}
        labelStyle={{ color: colors.text }} style={{ gap: 8 }}
        segmentStyle={({selected})=>({ paddingHorizontal: 16, borderWidth: 1, borderRadius: 4,
          borderColor: selected ? colors.accent : colors.border, backgroundColor: colors.surface })}
        onChange={consent => {
          telemetry.setConsent(consent);
          store.setState({ consent, diagnosticEvents: telemetry.exportTrace().events.length });
        }}/>
      <Text style={{ color: colors.muted }}>Retained events: {state.diagnosticEvents}</Text>
      <Action label="Share diagnostic trace" disabled={state.pending || state.consent === "off" || !state.diagnosticEvents}
        onPress={() => action(async () => { store.setState({ verification: await shareDiagnosticTrace(telemetry.exportTrace()) }); })}/>
      <Text style={{ color: colors.muted }}>
        Hardware keys: {isHardwareKeysAvailable() ? "linked" : "unavailable in this binary"}. F6 decreases gain, F7 Undo, F8 Redo.
      </Text>
      {state.lastShortcut ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Shortcut: {state.lastShortcut}</Text> : null}
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
            Rebuild the native app with the generated ForgeFactory and engine libraries, then retry the connection.
          </Text>
          <Action label="Retry connection" onPress={() =>
            store.setState(s => ({ attempt: s.attempt + 1 }))}/>
        </View>
      : null}
    {state.phase === "ready" && actual
      ? <View style={{ gap: 16 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap",
            alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {session && state.renderer === "native" ? <>
              <ArcKnob label="Gain" value={actual.gain} {...session.controls.gain}
                enabled={enabled} size={size}
                accentColor={colors.accent} textColor={colors.text}
                onPreview={gainPreview => store.setState({ gainPreview })}
                onCommit={value => execute(s => s.controls.gain.onCommit(value))}
                onError={reportError}/>
              <ArcKnob label="Pan" value={actual.pan} {...session.controls.pan}
                enabled={enabled} size={size}
                accentColor={colors.accent} textColor={colors.text}
                onPreview={panPreview => store.setState({ panPreview })}
                onCommit={value => execute(s => s.controls.pan.onCommit(value))}
                onError={reportError}/>
            </> : null}
            {session && state.renderer === "react-native" ? <>
              {/* InstrumentKnob is themed by the app's Tailwind classes. This lab has
                  none, so it renders unstyled on a light surface where default text reads. */}
              <InstrumentKnob label="Gain" value={actual.gain} {...session.knobs.gain}
                disabled={!enabled} size={size} unstyled accentColor={colors.accent}
                style={{ backgroundColor: colors.paper, borderRadius: 12, padding: 12 }}
                onPreview={gainPreview => store.setState({ gainPreview })}
                onCommit={value => execute(s => s.knobs.gain.onCommit(value)).catch(() => undefined)}/>
              <InstrumentKnob label="Pan" value={actual.pan} {...session.knobs.pan}
                disabled={!enabled} size={size} unstyled accentColor={colors.accent}
                style={{ backgroundColor: colors.paper, borderRadius: 12, padding: 12 }}
                onPreview={panPreview => store.setState({ panPreview })}
                onCommit={value => execute(s => s.knobs.pan.onCommit(value)).catch(() => undefined)}/>
            </> : null}
            {session && state.renderer === "xy" ? <InstrumentXYPad
              label="Gain and pan" {...session.xyPad} disabled={!enabled} size={size}
              unstyled accentColor={colors.accent}
              style={{ backgroundColor: colors.paper, borderRadius: 12, padding: 12 }}
              onPreview={point => store.setState({ gainPreview: point.y, panPreview: point.x * 2 - 1 })}
              onCommit={point => execute(s => s.xyPad.onCommit(point)).catch(() => undefined)}/>
              : null}
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
          <View accessibilityRole="radiogroup" accessibilityLabel="Knob renderer"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Action label="SwiftUI / Compose knob" selected={state.renderer === "native"}
              onPress={() => store.setState({ renderer: "native" })}/>
            <Action label="React Native knob" selected={state.renderer === "react-native"}
              onPress={() => store.setState({ renderer: "react-native" })}/>
            <Action label="Gain / Pan pad" selected={state.renderer === "xy"}
              onPress={() => store.setState({ renderer: "xy" })}/>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Action label="Reconnect native engine" disabled={state.pending} onPress={() =>
              store.setState(s => ({ attempt: s.attempt + 1 }))}/>
            <Action label="Verify native engines" disabled={state.pending} onPress={() =>
              action(async () => {
                store.setState({ verification: null });
                const verification = await verifyNativeEngines();
                console.info(verification);
                store.setState({ verification });
              })}/>
            <Action label="Verify native services" disabled={state.pending} onPress={() =>
              action(async () => {
                store.setState({ verification: null });
                const verification = await verifyNativeServices();
                console.info(verification);
                store.setState({ verification });
              })}/>
            <Action label="Verify native telemetry" disabled={state.pending} onPress={() =>
              action(async () => {
                store.setState({ verification: null });
                const verification = await verifyNativeTelemetry();
                store.setState({ verification });
              })}/>
            <Action label="Test picker cancellation" disabled={state.pending} onPress={() =>
              action(async () => { store.setState({ verification: await verifyPickerCancellation() }); })}/>
            <Action label="Share test snapshot" disabled={state.pending} onPress={() =>
              action(async () => { store.setState({ verification: await shareTestSnapshot() }); })}/>
            <Action label="Import test snapshot" disabled={state.pending} onPress={() =>
              action(async () => { store.setState({ verification: await importTestSnapshot() }); })}/>
            <Action label="Retain test bookmark" disabled={state.pending} onPress={() =>
              action(async () => { store.setState({ verification: await retainTestBookmark() }); })}/>
            <Action label="Restore test bookmark" disabled={state.pending} onPress={() =>
              action(async () => { store.setState({ verification: await restoreTestBookmark() }); })}/>
            <Action label="Test missing fixture" disabled={state.pending} onPress={() =>
              action(async () => { store.setState({ verification: await verifyMissingFixture() }); })}/>
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
          {state.verification ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {state.verification}
          </Text> : null}
        </View>
      : null}
    {state.error && state.phase === "ready"
      ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>
          {state.error}
        </Text> : null}
  </ScrollView>;
}
function Action({ label, disabled = false, selected, onPress }: {
  label: string; disabled?: boolean; selected?: boolean; onPress: () => void;
}) {
  return <Pressable
    accessibilityRole={selected === undefined ? "button" : "radio"} accessibilityLabel={label}
    accessibilityState={selected === undefined ? { disabled } : { disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({
      minHeight: 48, minWidth: 94, paddingHorizontal: 14, borderWidth: 1,
      borderColor: selected ? colors.accent : colors.border, borderRadius: 9,
      backgroundColor: colors.surface,
      justifyContent: "center", alignItems: "center",
      opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
    })}>
    <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
  </Pressable>;
}
