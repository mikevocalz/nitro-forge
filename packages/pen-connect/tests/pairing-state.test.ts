import { describe, expect, it } from "vitest";
import { presentPairing } from "@nyc-tron/ui/components/forge/devices/pairing-model";
import { penArtPhase, toPairingState } from "../src/pairing-state";
import type { PenConnectionState } from "../src/types";

const pen = { id: "AA:BB", name: "Logitech Muse", rssi: -58 };

describe("Forge pen controller -> NYC-Tron pairing state", () => {
  it("shows success only for a verified pen", () => {
    const linked: PenConnectionState = { kind: "linked", device: pen, detail: "awaiting-native-input" };
    const ready: PenConnectionState = { kind: "ready", device: pen, evidence: "verified-pen-protocol" };
    const system: PenConnectionState = { kind: "system-pairing", deviceName: "Logitech Muse", instructions: ["Open Settings"] };
    expect(toPairingState(linked).kind).toBe("connecting");
    expect(toPairingState(system).kind).toBe("connecting");
    expect(toPairingState(ready)).toEqual({
      kind: "connected", device: { id: "AA:BB", name: "Logitech Muse", signalDbm: -58 },
    });
    expect(presentPairing(toPairingState(linked), "pen", false).body).not.toMatch(/^Connected/);
    expect(penArtPhase(linked)).toBe("linked");
    expect(penArtPhase(ready)).toBe("connected");
  });

  it("keeps the device list and drops readings NYC-Tron cannot label", () => {
    const found: PenConnectionState = {
      kind: "found", devices: [pen, { id: "CC", name: "Other pen" }, { id: "DD", name: "Bad", rssi: Number.NaN }],
    };
    const mapped = toPairingState(found);
    expect(mapped).toEqual({
      kind: "found",
      devices: [
        { id: "AA:BB", name: "Logitech Muse", signalDbm: -58 },
        { id: "CC", name: "Other pen" },
        { id: "DD", name: "Bad" },
      ],
    });
    // Would throw on NaN signal if it reached the row label.
    expect(() => presentPairing(mapped, "pen", true)).not.toThrow();
    expect(presentPairing({ kind: "found", devices: [] }, "pen", false).body).toMatch(/^No pen found/);
  });

  it("maps every controller error to a code with a recovery action", () => {
    const codes = ["permission", "disabled", "scan", "connection", "disconnected", "unsupported"] as const;
    const mapped = codes.map((code) => toPairingState({ kind: "error", code, message: "native detail " + code }));
    expect(mapped.map((s) => s.kind === "error" && s.code)).toEqual([
      "permission-denied", "radio-off", "unknown", "connection-failed", "connection-failed", "unknown",
    ]);
    for (const state of mapped) expect(presentPairing(state, "pen", true).primary).toBeDefined();
    // NYC-Tron's guidance replaces the controller's restatement for these.
    expect(mapped[0]).toEqual({ kind: "error", code: "permission-denied" });
    expect(mapped[4]).toEqual({ kind: "error", code: "connection-failed", message: "native detail disconnected" });
  });

  it("treats the permission prompt as the start of a search", () => {
    expect(toPairingState({ kind: "requesting-permission" })).toEqual({ kind: "scanning" });
    expect(toPairingState({ kind: "explaining-permission", mode: "bluetooth-le" })).toEqual({ kind: "idle" });
    expect(penArtPhase({ kind: "requesting-permission" })).toBe("pairing");
  });
});
