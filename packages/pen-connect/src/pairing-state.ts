import type { PairingDevice, PairingState } from "@nyc-tron/ui/components/forge/devices/pairing-model";
import type { PenConnectionState, PenDevice } from "./types";

/** Phase handed to {@linkcode PenConnectionDialogProps.renderAnimation}; one per Rive artboard. */
export type PenConnectionArtPhase = "searching" | "pairing" | "linked" | "connected" | "error";

const toPairingDevice = (device: PenDevice): PairingDevice => ({
  id: device.id,
  name: device.name,
  // NYC-Tron's signalLabel throws on a non-finite reading.
  ...(device.rssi !== undefined && Number.isFinite(device.rssi) ? { signalDbm: device.rssi } : {}),
});

/**
 * Maps the Forge pen controller onto NYC-Tron's transport-agnostic pairing
 * state. Only `ready` (native input verified) becomes `connected`. A Bluetooth
 * link still waiting for pen input, and a system-owned pairing still waiting
 * for tracking, both stay `connecting`: the success state is never shown for
 * an unverified pen.
 */
export function toPairingState(state: PenConnectionState): PairingState {
  switch (state.kind) {
    case "idle":
    case "explaining-permission":
      return { kind: "idle" };
    // The OS permission sheet is up; NYC-Tron has no waiting-for-permission
    // state, and searching follows straight after a grant.
    case "requesting-permission":
    case "scanning":
      return { kind: "scanning" };
    case "found":
      return { kind: "found", devices: state.devices.map(toPairingDevice) };
    case "system-pairing":
      return { kind: "connecting", device: { id: "system-spatial-pen", name: state.deviceName } };
    case "connecting":
    case "linked":
      return { kind: "connecting", device: toPairingDevice(state.device) };
    case "ready":
      return { kind: "connected", device: toPairingDevice(state.device) };
    case "error":
      switch (state.code) {
        // NYC-Tron's own copy for these three names the fix; the controller's
        // message only restates the failure.
        case "permission": return { kind: "error", code: "permission-denied" };
        case "disabled": return { kind: "error", code: "radio-off" };
        case "connection": return { kind: "error", code: "connection-failed" };
        case "disconnected": return { kind: "error", code: "connection-failed", message: state.message };
        case "scan":
        case "unsupported":
          return { kind: "error", code: "unknown", message: state.message };
      }
  }
}

/** Rive artboard for a controller state. `linked` keeps its own amber artboard. */
export function penArtPhase(state: PenConnectionState): PenConnectionArtPhase {
  switch (state.kind) {
    case "scanning": return "searching";
    case "linked": return "linked";
    case "ready": return "connected";
    case "error": return "error";
    default: return "pairing";
  }
}
