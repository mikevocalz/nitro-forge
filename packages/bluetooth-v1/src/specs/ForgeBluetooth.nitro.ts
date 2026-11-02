import { Android, type HybridObject } from "nitro-core";
export * from "#nitro/ForgeBluetooth";

/** Android BLE GATT only. No Logitech Muse services or protocol assumed. */
@Android({ language: "kotlin", implementation: { className: "HybridForgeBluetooth", package: ["ble"] } })
export declare class ForgeBluetooth extends HybridObject {
  static readonly isAvailable: boolean;
  isEnabled(): boolean;
  startScan(): void;
  stopScan(): void;
  getDevicesJson(): string;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): void;
  isConnected(): boolean;
}
