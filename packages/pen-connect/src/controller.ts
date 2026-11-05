import { createStore, type StoreApi } from "zustand/vanilla";
import type { BlePenPort, PenConnectMode, PenConnectionPort, PenConnectionState, PenDevice, PenLink, PenVerification } from "./types";

export interface PenConnectionController {
  readonly state: StoreApi<PenConnectionState>;
  /** How this platform connects; the dialog explains it before {@linkcode begin}. */
  readonly mode: PenConnectMode;
  /**
   * Requests the OS Bluetooth permission. Call it from the Connect tap only;
   * the rationale is the idle copy shown before that tap.
   */
  begin(): Promise<void>;
  /** Start another foreground scan with previously granted permissions. */
  rescan(): Promise<void>;
  /** Connect only to a device from the actual last scan. */
  connect(deviceId: string): Promise<void>;
  /** Receives trusted native tracking/protocol status; never called by UI. */
  verifyNativeInput(sample: PenVerification): void;
  /** Cancel any active scan/link. Safe to call multiple times. */
  cancel(): Promise<void>;
  dispose(): void;
}

export function createPenConnectionController(port: PenConnectionPort): PenConnectionController {
  const state = createStore<PenConnectionState>(() => ({ kind: "idle" }));
  let epoch = 0;
  let disposed = false;
  let link: PenLink | undefined;
  let unsubscribeLink: (() => void) | undefined;
  let devices: readonly PenDevice[] = [];
  let pairedDevice: PenDevice | undefined;
  let granted = false;
  const valid = (generation: number) => !disposed && generation === epoch;
  const transition = (next: PenConnectionState) => { if (!disposed) state.setState(next); };
  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  const release = () => {
    unsubscribeLink?.();
    unsubscribeLink = undefined;
    const old = link;
    link = undefined;
    pairedDevice = undefined;
    if (old !== undefined) void old.disconnect().catch(() => undefined);
  };
  const reportError = (generation: number, code: Extract<PenConnectionState, {kind:"error"}>["code"], error: unknown) => {
    if (valid(generation)) transition({kind:"error",code,message:message(error)});
  };
  const doScan = async (generation: number, transport: BlePenPort) => {
    if (!valid(generation)) return;
    transition({kind:"scanning"});
    devices = [];
    try {
      const scanResults = await transport.scan();
      if (!valid(generation)) return;
      // Limit display count and reject phantom/malformed devices.
      const unique = new Map<string, PenDevice>();
      for (const device of scanResults) {
        if (typeof device.id !== "string" || !device.id.trim()) continue;
        if (typeof device.name !== "string" || !device.name.trim()) continue;
        if (!unique.has(device.id)) unique.set(device.id, device);
        if (unique.size >= 50) break;
      }
      devices = [...unique.values()];
      transition({kind:"found",devices});
    } catch (error) {
      reportError(generation,"scan",error);
    }
  };
  return {
    state,
    mode: port.mode,
    async begin() {
      if (disposed) return;
      const generation = ++epoch;
      port.mode === "bluetooth-le" && port.cancelScan();
      release();
      devices = [];
      granted = false;
      if (port.mode === "system-spatial") {
        transition({kind:"system-pairing",deviceName:port.deviceName,instructions:port.pairingInstructions});
        return;
      }
      // begin() is the Connect tap, so the system dialog opens right away;
      // the rationale was the idle copy the user read before tapping.
      transition({kind:"requesting-permission"});
      try {
        granted = await port.requestAccess();
        if (!valid(generation)) return;
        if (!granted) {
          transition({kind:"error",code:"permission",message:"Bluetooth permission was not granted."});
          return;
        }
        if (!(await port.ensureEnabled())) {
          if (valid(generation)) transition({kind:"error",code:"disabled",message:"Bluetooth is switched off or enabling was declined."});
          return;
        }
        await doScan(generation,port);
      } catch (error) {
        reportError(generation,"permission",error);
      }
    },
    async rescan() {
      if (disposed || port.mode !== "bluetooth-le") return;
      const generation = ++epoch;
      port.cancelScan();
      release();
      if (!granted) {
        transition({kind:"error",code:"permission",message:"Bluetooth permission is required; choose Connect to request access."});
        return;
      }
      await doScan(generation,port);
    },
    async connect(deviceId) {
      if (disposed || port.mode !== "bluetooth-le") return;
      const device = devices.find((d) => d.id === deviceId);
      if (device === undefined) {
        transition({kind:"error",code:"unsupported",message:"Select a device from the latest Bluetooth scan."});
        return;
      }
      const generation = ++epoch;
      port.cancelScan();
      release();
      transition({kind:"connecting",device});
      try {
        const nextLink = await port.connect(device.id);
        if (!valid(generation)) {
          await nextLink.disconnect().catch(() => undefined);
          return;
        }
        link = nextLink;
        pairedDevice = device;
        unsubscribeLink = nextLink.onDisconnected?.((reason) => {
          if (!valid(generation)) return;
          const detachedLink = link;
          link = undefined;
          unsubscribeLink?.();
          unsubscribeLink = undefined;
          pairedDevice = undefined;
          // Some native transports emit an unplug callback before disposing
          // their GATT handle. Explicitly release it; the port must implement
          // idempotent disconnect so a spontaneous disconnect is safe.
          if (detachedLink !== undefined) void detachedLink.disconnect().catch(() => undefined);
          transition({kind:"error",code:"disconnected",message:reason ?? "Bluetooth connection was lost."});
        });
        transition({kind:"linked",device,detail:"awaiting-native-input"});
      } catch (error) {
        reportError(generation,"connection",error);
      }
    },
    verifyNativeInput(sample) {
      if (disposed) return;
      if (!sample.tracked) {
        const current = state.getState();
        if (current.kind === "ready") {
          if (port.mode === "system-spatial") {
            transition({kind:"system-pairing",deviceName:port.deviceName,instructions:port.pairingInstructions});
          } else {
            transition({kind:"linked",device:current.device,detail:"awaiting-native-input"});
          }
        }
        return;
      }
      if (port.mode === "system-spatial") {
        if (sample.evidence !== "visionos-spatial-stream") return;
        // The actual Viro SDK must be the source of this event; generic
        // Bluetooth status alone cannot prove 6DoF tracking.
        transition({kind:"ready",device:{id:"visionos-spatial-muse",name:port.deviceName},evidence:sample.evidence});
        return;
      }
      if (sample.evidence !== "verified-pen-protocol") return;
      const current = state.getState();
      if ((current.kind !== "linked" && current.kind !== "ready") ||
          pairedDevice === undefined || current.device.id !== pairedDevice.id ||
          sample.deviceId !== pairedDevice.id) return;
      transition({kind:"ready",device:pairedDevice,evidence:sample.evidence});
    },
    async cancel() {
      if (disposed) return;
      ++epoch;
      if (port.mode === "bluetooth-le") port.cancelScan();
      unsubscribeLink?.();
      unsubscribeLink = undefined;
      const lastLink = link;
      link = undefined;
      pairedDevice = undefined;
      if (lastLink !== undefined) await lastLink.disconnect().catch(() => undefined);
      transition({kind:"idle"});
    },
    dispose() {
      if (disposed) return;
      ++epoch;
      if (port.mode === "bluetooth-le") port.cancelScan();
      release();
      disposed = true;
    },
  };
}
