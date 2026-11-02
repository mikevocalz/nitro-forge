import { useStore } from "zustand";
import type { ReactElement, ReactNode } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import type { PenConnectionController } from "./controller";
import type { PenConnectionState, PenDevice } from "./types";

/**
 * The animation is a view of VERIFIED status, never the source of truth.
 * Supply a compiled Rive CLI status component via renderAnimation.
 * An unverified Bluetooth link must not show the success animation.
 */
export interface PenConnectionDialogProps {
  readonly visible: boolean;
  readonly controller: PenConnectionController;
  readonly onClose: () => void;
  readonly title?: string;
  readonly renderAnimation?: (
    phase: "searching" | "pairing" | "linked" | "connected" | "error",
  ) => ReactNode;
}
const describe = (state: PenConnectionState): string => {
  switch (state.kind) {
    case "idle": return "Connect a pen to draw.";
    case "explaining-permission": return "Bluetooth access is needed to find compatible pens.";
    case "requesting-permission": return "Waiting for the system Bluetooth permission dialog…";
    case "system-pairing": return "Pair in your headset's Bluetooth Settings. The pen is ready only when tracking is available.";
    case "scanning": return "Searching for nearby Bluetooth accessories…";
    case "found": return state.devices.length ? "Choose a device found by Bluetooth." : "No nearby devices found. Check pairing mode and scan again.";
    case "connecting": return "Establishing a Bluetooth connection…";
    case "linked": return "Bluetooth linked. Waiting for compatible pen input; pressure and spatial tracking remain unverified.";
    case "ready": return "Connected — native pen input verified.";
    case "error": return state.message;
  }
};
const stateAnimation = (state: PenConnectionState): "searching" | "pairing" | "linked" | "connected" | "error" => {
  if (state.kind === "scanning") return "searching";
  if (state.kind === "ready") return "connected";
  if (state.kind === "linked") return "linked";
  if (state.kind === "error") return "error";
  return "pairing";
};
function DeviceOption({device, onPress}: {readonly device: PenDevice; readonly onPress: () => void}): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={"Connect to " + device.name} onPress={onPress} style={styles.deviceOption}>
      <Text style={styles.deviceTitle}>{device.name}</Text>
      <Text style={styles.detail}>{device.rssi === undefined ? "Bluetooth device" : "Signal " + device.rssi + " dBm"}</Text>
    </Pressable>
  );
}
export function PenConnectionDialog({
  visible, controller, onClose, title = "Connect your pen", renderAnimation,
}: PenConnectionDialogProps): ReactElement {
  const state = useStore(controller.state, (s) => s);
  const phase = stateAnimation(state);
  const busy = state.kind === "requesting-permission" || state.kind === "scanning" || state.kind === "connecting";
  const finish = () => {
    // Closing an established link is not a disconnect action.
    if (state.kind !== "ready" && state.kind !== "linked") void controller.cancel();
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish} presentationStyle="overFullScreen" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.topRow}>
            <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
            <Pressable accessibilityLabel="Close pen connection dialog" accessibilityRole="button" onPress={finish} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.animation} accessibilityLabel={state.kind === "ready" ? "Pen connection verified" : undefined}>
            {renderAnimation ? renderAnimation(phase) : busy
              ? <ActivityIndicator accessibilityLabel="Connecting" size="large" color="#8F7AFF" />
              : <Text style={styles.glyph}>{state.kind === "ready" ? "✓" : state.kind === "error" ? "!" : "✎"}</Text>}
          </View>
          <Text style={styles.description}>{describe(state)}</Text>
          {state.kind === "system-pairing" ? (
            <View style={styles.steps}>
              {state.instructions.map((step, i) => (
                <Text key={String(i) + step} style={styles.step}>{i + 1}. {step}</Text>
              ))}
              <Text style={styles.detail}>System Settings controls pairing. This app cannot approve it on your behalf.</Text>
            </View>
          ) : null}
          {state.kind === "found" ? (
            <FlatList style={styles.devices} data={[...state.devices]} keyExtractor={(item) => item.id}
              renderItem={({item}) => <DeviceOption device={item} onPress={() => void controller.connect(item.id)} />}
              ListEmptyComponent={<Text style={styles.detail}>No Bluetooth devices discovered.</Text>} />
          ) : null}
          {state.kind === "idle" || state.kind === "error" ? (
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void controller.begin()}>
              <Text style={styles.primaryLabel}>{state.kind === "idle" ? "Connect pen" : "Try again"}</Text>
            </Pressable>
          ) : null}
          {state.kind === "found" ? (
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void controller.rescan()}>
              <Text style={styles.primaryLabel}>Scan again</Text>
            </Pressable>
          ) : null}
          {state.kind === "ready" ? (
            <Pressable accessibilityRole="button" style={styles.primary} onPress={finish}>
              <Text style={styles.primaryLabel}>Start drawing</Text>
            </Pressable>
          ) : null}
          {state.kind === "scanning" ? (
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void controller.cancel()}>
              <Text style={styles.secondaryLabel}>Cancel scan</Text>
            </Pressable>
          ) : null}
          {state.kind === "linked" ? (
            <Text style={styles.detail}>Connected to {state.device.name}. Native pen input must still be verified.</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {flex:1, backgroundColor:"rgba(0,0,0,0.68)", alignItems:"center", justifyContent:"center", padding:24},
  sheet: {backgroundColor:"#17171C", borderColor:"#42424F", borderWidth:1, borderRadius:24, padding:20, width:"100%", maxWidth:480, maxHeight:"90%"},
  topRow: {flexDirection:"row", alignItems:"center", justifyContent:"space-between", gap:12},
  heading: {color:"#FFFFFF", fontSize:21, fontWeight:"700", flexShrink:1},
  closeButton: {padding:8, minHeight:44, minWidth:44, justifyContent:"center"},
  closeText: {color:"#D8D8E6", fontSize:14},
  animation: {height:108, justifyContent:"center", alignItems:"center"},
  glyph: {color:"#A796FF", fontSize:64, fontWeight:"500"},
  description: {color:"#E9E8F1", lineHeight:23, fontSize:15, marginBottom:14},
  detail: {color:"#AAA9B8", fontSize:13, lineHeight:19},
  steps: {gap:8, padding:12, backgroundColor:"#25252D", borderRadius:12, marginBottom:14},
  step: {fontSize:14, color:"#F3F0FB", lineHeight:21},
  devices: {maxHeight:220, marginBottom:12},
  deviceOption: {borderColor:"#565263", borderWidth:1, borderRadius:12, marginBottom:8, minHeight:64, padding:12, justifyContent:"center"},
  deviceTitle: {color:"#FFFFFF", fontSize:16, fontWeight:"600", marginBottom:4},
  primary: {backgroundColor:"#7764D9", borderRadius:12, minHeight:48, alignItems:"center", justifyContent:"center", marginTop:8},
  primaryLabel: {color:"white", fontSize:16, fontWeight:"700"},
  secondary: {backgroundColor:"#30303A", borderRadius:12, minHeight:48, alignItems:"center", justifyContent:"center", marginTop:8},
  secondaryLabel: {color:"white", fontSize:16, fontWeight:"600"},
});
