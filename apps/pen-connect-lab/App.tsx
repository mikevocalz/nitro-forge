import { useState } from "react";
import { Button } from "@nyc-tron/ui/components/Button";
import { Card } from "@nyc-tron/ui/components/Card";
import {
  createPenConnectionController,
  type BlePenPort,
  type PenConnectionState,
} from "@nitro-forge/pen-connect";
import { PenConnectionDialog } from "@nitro-forge/pen-connect/native";

/**
 * Review surface for the pen pairing dialog. The transport is a fixture: no
 * Bluetooth radio, permission prompt or pen protocol runs here. `?state=` on
 * web picks the controller state to review.
 */
const fixtureDevices = [
  { id: "C4:7F:51:02:9A:10", name: "Logitech Muse", rssi: -52 },
  { id: "E8:2A:EA:11:04:7B", name: "Pixel Buds Pro", rssi: -71 },
  { id: "F0:99:B6:3C:22:01", name: "Desk speaker", rssi: -84 },
] as const;

const fixturePort: BlePenPort = {
  mode: "bluetooth-le",
  requestAccess: async () => true,
  ensureEnabled: async () => true,
  scan: async () => fixtureDevices,
  cancelScan: () => undefined,
  connect: async () => ({ disconnect: async () => undefined }),
};

const pen = fixtureDevices[0];
const states: Record<string, PenConnectionState> = {
  idle: { kind: "idle" },
  scanning: { kind: "scanning" },
  found: { kind: "found", devices: fixtureDevices },
  empty: { kind: "found", devices: [] },
  connecting: { kind: "connecting", device: pen },
  linked: { kind: "linked", device: pen, detail: "awaiting-native-input" },
  ready: { kind: "ready", device: pen, evidence: "verified-pen-protocol" },
  permission: { kind: "error", code: "permission", message: "Bluetooth permission was not granted." },
  disabled: { kind: "error", code: "disabled", message: "Bluetooth is switched off or enabling was declined." },
  disconnected: { kind: "error", code: "disconnected", message: "The pen disconnected." },
};

function initialState(): PenConnectionState {
  const key = typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("state");
  return (key !== null && key !== undefined && states[key]) || { kind: "idle" };
}

export default function App() {
  const [controller] = useState(() => {
    const created = createPenConnectionController(fixturePort);
    created.state.setState(initialState(), true);
    return created;
  });
  const [visible, setVisible] = useState(true);
  return (
    <Card surface="sunken" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      {visible ? null : <Button title="Connect your pen" onPress={() => setVisible(true)} />}
      <PenConnectionDialog
        visible={visible}
        controller={controller}
        onClose={() => setVisible(false)}
        onOpenBluetoothSettings={() => undefined}
      />
    </Card>
  );
}
