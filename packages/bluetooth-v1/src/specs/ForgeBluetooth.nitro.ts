import { Android, type HybridObject } from "nitro-core";
export * from "#nitro/ForgeBluetooth";

/** Android BLE GATT only. No Logitech Muse services or protocol assumed. */
@Android({ language: "kotlin", implementation: { className: "HybridForgeBluetooth", package: ["ble"] } })
export declare class ForgeBluetooth extends HybridObject {
  static readonly isAvailable: boolean;
  isEnabled(): boolean;
  /** Open Android system Bluetooth Settings; does not assert radio was enabled. */
  openBluetoothSettings(): void;
  startScan(): void;
  stopScan(): void;
  getDevicesJson(): string;
  getScanError(): string;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): void;
  isConnected(): boolean;
}
