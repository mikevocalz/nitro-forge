/**
 * "Bluetooth link established" is NOT "spatial pen ready".
 * A device may pair or expose a GATT service without any accessible
 * pressure/6DoF protocol. Only real native input proves readiness.
 */
export type PenConnectMode = "system-spatial" | "bluetooth-le";
export interface PenDevice {
  readonly id: string;
  readonly name: string;
  readonly rssi?: number;
}
export interface PenLink {
  /** Must resolve only after real OS/GATT connection success. */
  disconnect(): Promise<void>;
  onDisconnected?(listener: (reason?: string) => void): () => void;
}
export interface BlePenPort {
  readonly mode: "bluetooth-le";
  requestAccess(): Promise<boolean>;
  ensureEnabled(): Promise<boolean>;
  /** Real Bluetooth scan; must not fabricate Logitech Muse devices. */
  scan(): Promise<readonly PenDevice[]>;
  cancelScan(): void;
  connect(id: string): Promise<PenLink>;
}
export interface SystemSpatialPenPort {
  readonly mode: "system-spatial";
  readonly deviceName: string;
  /** A system-owned accessory cannot be paired by app-level BLE calls. */
  readonly pairingInstructions: readonly string[];
}
export type PenConnectionPort = BlePenPort | SystemSpatialPenPort;

export type PenConnectionState =
  | { readonly kind: "idle" }
  | { readonly kind: "explaining-permission"; readonly mode: PenConnectMode }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "system-pairing"; readonly deviceName: string; readonly instructions: readonly string[] }
  | { readonly kind: "scanning" }
  | { readonly kind: "found"; readonly devices: readonly PenDevice[] }
  | { readonly kind: "connecting"; readonly device: PenDevice }
  | { readonly kind: "linked"; readonly device: PenDevice; readonly detail: "awaiting-native-input" }
  | { readonly kind: "ready"; readonly device: PenDevice; readonly evidence: "visionos-spatial-stream" | "verified-pen-protocol" }
  | { readonly kind: "error"; readonly code: "permission" | "disabled" | "scan" | "connection" | "disconnected" | "unsupported"; readonly message: string };
export interface PenVerification {
  /** Only call from a real native pen input/protocol callback, never a button. */
  readonly evidence: "visionos-spatial-stream" | "verified-pen-protocol";
  readonly tracked: boolean;
  readonly deviceId?: string;
}
