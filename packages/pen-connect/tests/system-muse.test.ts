import { describe, expect, it } from "vitest";
import { visionOSMusePort, createPenConnectionController } from "../src";
describe("visionOS Muse system Bluetooth connection", () => {
  it("gives official system pairing steps and does not claim a link from pressing Connect", async () => {
    const c=createPenConnectionController(visionOSMusePort);
    await c.begin();
    expect(c.state.getState().kind).toBe("system-pairing");
    if (c.state.getState().kind === "system-pairing") {
      expect(c.state.getState().instructions.some(s=>s.includes("Settings"))).toBe(true);
    }
    c.verifyNativeInput({ evidence: "visionos-spatial-stream", tracked: true });
    expect(c.state.getState().kind).toBe("ready");
    c.dispose();
  });
});
