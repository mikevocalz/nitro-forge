import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "android", Version: 36 },
  PermissionsAndroid: {
    RESULTS: { GRANTED: "granted" },
    requestMultiple: vi.fn(async () => ({
      "android.permission.BLUETOOTH_SCAN": "granted",
      "android.permission.BLUETOOTH_CONNECT": "granted",
    })),
  },
}));

import { createAndroidBlePenPort, type ForgeBluetoothAndroid } from "../src/android-ble.native";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  let connected = true;
  let throwDuringPoll = false;
  const disconnect = vi.fn(() => { connected = false; });
  const native: ForgeBluetoothAndroid = {
    isEnabled: () => true,
    openBluetoothSettings: () => {},
    startScan: () => {},
    stopScan: () => {},
    getDevicesJson: () => "[]",
    getScanError: () => "",
    connect: vi.fn(async () => { connected = true; return true; }),
    disconnect,
    isConnected: () => {
      if (throwDuringPoll) throw new Error("native GATT service terminated");
      return connected;
    },
  };
  return {
    native, disconnect,
    setConnected: (value: boolean) => { connected = value; },
    setThrowDuringPoll: (value: boolean) => { throwDuringPoll = value; },
  };
}

describe("Android Nitro v1 BLE disconnection cleanup", () => {
  it("releases GATT once when remote device disconnects", async () => {
    vi.useFakeTimers();
    const f = setup();
    const port = createAndroidBlePenPort(f.native, { connectionPollMs: 250 });
    const link = await port.connect("device-A");
    const notices: string[] = [];
    link.onDisconnected!(reason => { notices.push(reason ?? "unknown"); });
    f.setConnected(false);
    vi.advanceTimersByTime(250);
    expect(notices).toEqual(["Bluetooth link disconnected."]);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    await link.disconnect();
    vi.advanceTimersByTime(750);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(notices).toHaveLength(1);
  });

  it("releases GATT when native connection polling throws", async () => {
    vi.useFakeTimers();
    const f = setup();
    const port = createAndroidBlePenPort(f.native, { connectionPollMs: 250 });
    const link = await port.connect("device-A");
    const notices: string[] = [];
    link.onDisconnected!(reason => { notices.push(reason ?? "unknown"); });
    f.setThrowDuringPoll(true);
    vi.advanceTimersByTime(250);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(notices).toEqual(["native GATT service terminated"]);
    await link.disconnect();
    expect(f.disconnect).toHaveBeenCalledTimes(1);
  });

  it("explicit disconnect cancels polling and native release cannot repeat", async () => {
    vi.useFakeTimers();
    const f = setup();
    const port = createAndroidBlePenPort(f.native, { connectionPollMs: 250 });
    const link = await port.connect("device-A");
    const notices = vi.fn();
    link.onDisconnected!(notices);
    await link.disconnect();
    await link.disconnect();
    vi.advanceTimersByTime(2000);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(notices).not.toHaveBeenCalled();
  });
});

describe("Android Nitro v1 BLE scan generations", () => {
  function scanningNative() {
    let scanning = false;
    const startScan = vi.fn(() => { scanning = true; });
    const stopScan = vi.fn(() => { scanning = false; });
    const native: ForgeBluetoothAndroid = {
      isEnabled: () => true,
      openBluetoothSettings: () => {},
      startScan,
      stopScan,
      getDevicesJson: () => JSON.stringify([{ id: "AA:BB", name: "Pen", rssi: -40 }]),
      getScanError: () => "",
      connect: async () => true,
      disconnect: () => {},
      isConnected: () => true,
    };
    return { native, startScan, stopScan, isScanning: () => scanning };
  }

  it("a cancelled scan's cleanup does not stop the newer scan started by rescan", async () => {
    vi.useFakeTimers();
    const f = scanningNative();
    const port = createAndroidBlePenPort(f.native, { scanDurationMs: 1000 });
    const first = port.scan();
    // Same order as controller.rescan(): cancel, then start the next scan.
    port.cancelScan();
    const second = port.scan();
    await expect(first).resolves.toEqual([]);
    expect(f.startScan).toHaveBeenCalledTimes(2);
    expect(f.isScanning()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toEqual([{ id: "AA:BB", name: "Pen", rssi: -40 }]);
    expect(f.isScanning()).toBe(false);
  });

  it("an overlapping scan supersedes the previous one without stopping itself", async () => {
    vi.useFakeTimers();
    const f = scanningNative();
    const port = createAndroidBlePenPort(f.native, { scanDurationMs: 1000 });
    const first = port.scan();
    const second = port.scan();
    await expect(first).resolves.toEqual([]);
    expect(f.isScanning()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toHaveLength(1);
    expect(f.isScanning()).toBe(false);
  });
});

describe("controller.rescan() over the real Android port", () => {
  it("keeps the rescan's native scan running after the cancelled scan unwinds", async () => {
    vi.useFakeTimers();
    const { createPenConnectionController } = await import("../src/controller");
    let scanning = false;
    const native: ForgeBluetoothAndroid = {
      isEnabled: () => true,
      openBluetoothSettings: () => {},
      startScan: () => { scanning = true; },
      stopScan: () => { scanning = false; },
      getDevicesJson: () => JSON.stringify([{ id: "AA:BB", name: "Pen" }]),
      getScanError: () => "",
      connect: async () => true,
      disconnect: () => {},
      isConnected: () => true,
    };
    const c = createPenConnectionController(createAndroidBlePenPort(native, { scanDurationMs: 1000 }));
    const begun = c.begin();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.state.getState().kind).toBe("scanning");
    const rescanned = c.rescan();
    await vi.advanceTimersByTimeAsync(0);
    expect(scanning).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await begun;
    await rescanned;
    expect(c.state.getState()).toMatchObject({ kind: "found", devices: [{ id: "AA:BB", name: "Pen" }] });
    expect(scanning).toBe(false);
  });
});
