import { PermissionsAndroid, Platform } from "react-native";
import type { BlePenPort, PenDevice, PenLink } from "./types";

/**
 * The explicit native Nitro v1 interface; dependency injected so the portable
 * pairing dialog never loads native modules on visionOS or the web.
 */
export interface ForgeBluetoothAndroid {
  isEnabled(): boolean;
  openBluetoothSettings(): void;
  startScan(): void;
  stopScan(): void;
  getDevicesJson(): string;
  getScanError(): string;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): void;
  isConnected(): boolean;
}
export interface AndroidBleOptions {
  readonly scanDurationMs?: number;
  readonly connectionPollMs?: number;
}

/**
 * Native Android BLE GATT support. Bluetooth pairing is system-owned;
 * this adapter requests real Android permissions only after an explicit tap.
 * A GATT link does not imply Muse protocol/pressure/6DoF support.
 */
export function createAndroidBlePenPort(
  native: ForgeBluetoothAndroid,
  options: AndroidBleOptions = {},
): BlePenPort {
  const duration = options.scanDurationMs ?? 6000;
  const polling = options.connectionPollMs ?? 1200;
  if (!Number.isFinite(duration) || duration < 500 || duration > 30000) {
    throw new RangeError("scanDurationMs must be 500..30000");
  }
  if (!Number.isFinite(polling) || polling < 250 || polling > 60000) {
    throw new RangeError("connectionPollMs must be 250..60000");
  }
  let cancelPending: (() => void) | undefined;
  // Each scan() owns one generation. Only the scan that is still current may
  // stop the native scanner, so a superseded scan's cleanup cannot stop the
  // newer scan that rescan() started right after cancelling it.
  let scanGeneration = 0;

  return {
    mode: "bluetooth-le",
    async requestAccess() {
      if (Platform.OS !== "android") return false;
      const api = typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);
      const permissions = api >= 31
        ? ["android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"]
        : ["android.permission.ACCESS_FINE_LOCATION"];
      const statuses = await PermissionsAndroid.requestMultiple(permissions as Array<"android.permission.BLUETOOTH_SCAN" | "android.permission.BLUETOOTH_CONNECT" | "android.permission.ACCESS_FINE_LOCATION">);
      return permissions.every((name) => statuses[name as keyof typeof statuses] === PermissionsAndroid.RESULTS.GRANTED);
    },
    async ensureEnabled() {
      return Platform.OS === "android" && native.isEnabled();
    },
    async scan() {
      if (Platform.OS !== "android") return [];
      cancelPending?.();
      const generation = ++scanGeneration;
      native.startScan();
      let interrupted = false;
      try {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { cancelPending = undefined; resolve(); }, duration);
          cancelPending = () => { interrupted = true; clearTimeout(timeout); cancelPending = undefined; resolve(); };
        });
        if (interrupted) return [];
        const error = native.getScanError();
        if (error) throw new Error(error);
        const data: unknown = JSON.parse(native.getDevicesJson());
        if (!Array.isArray(data)) throw new Error("Invalid native BLE scan result");
        const devices: PenDevice[] = [];
        for (const item of data.slice(0, 50)) {
          if (!item || typeof item !== "object") continue;
          const d = item as Record<string, unknown>;
          if (typeof d.id !== "string" || typeof d.name !== "string" || !d.id || !d.name) continue;
          const rssi = d.rssi;
          devices.push({
            id: d.id, name: d.name,
            ...(typeof rssi === "number" && Number.isFinite(rssi) ? { rssi } : {}),
          });
        }
        return devices;
      } finally {
        if (generation === scanGeneration) native.stopScan();
      }
    },
    cancelScan() {
      ++scanGeneration;
      cancelPending?.();
      native.stopScan();
    },
    async connect(id) {
      if (!(await native.connect(id))) throw new Error("Bluetooth GATT connection failed.");
      let disposed = false;
      let pollTimer: ReturnType<typeof setInterval> | undefined;
      const closeNative = () => {
        // A disconnected link still owns a native GATT object. Always close it
        // exactly once, including the spontaneous-disconnect and scan-error
        // paths, so repeated pairing cannot leak native BLE resources.
        if (disposed) return;
        disposed = true;
        if (pollTimer !== undefined) clearInterval(pollTimer);
        pollTimer = undefined;
        native.disconnect();
      };
      const link: PenLink = {
        async disconnect() {
          closeNative();
        },
        onDisconnected(listener) {
          if (disposed) return () => undefined;
          if (pollTimer !== undefined) clearInterval(pollTimer);
          pollTimer = setInterval(() => {
            if (disposed) return;
            let reason = "Bluetooth link disconnected.";
            try {
              if (native.isConnected()) return;
            } catch (error) {
              reason = error instanceof Error ? error.message : "Bluetooth link was lost.";
            }
            try {
              closeNative();
            } catch (error) {
              reason = error instanceof Error ? error.message : reason;
            }
            listener(reason);
          }, polling);
          return () => {
            if (pollTimer !== undefined) clearInterval(pollTimer);
            pollTimer = undefined;
          };
        },
      };
      return link;
    },
  };
}
