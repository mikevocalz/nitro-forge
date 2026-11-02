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
