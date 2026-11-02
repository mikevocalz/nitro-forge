import { describe, expect, it } from "vitest";
import { createPenConnectionController } from "../src";
import type { BlePenPort, PenLink } from "../src";

function fakePort() {
  let allowed = true, enabled = true, dropped: ((reason?: string) => void) | undefined;
  let connects = 0, scans = 0, cancelCalls = 0, disconnectCalls = 0;
  const device = {id:"device:A",name:"Test BLE stylus",rssi:-50};
  const port: BlePenPort = {
    mode:"bluetooth-le", requestAccess: async () => allowed,
    ensureEnabled: async () => enabled,
    scan: async () => {scans++; return [device,device];},
    cancelScan: () => {cancelCalls++;},
    connect: async (id) => {
      if (id !== device.id) throw new Error("unknown device");
      connects++;
      const link: PenLink = {
        disconnect: async () => {disconnectCalls++;},
        onDisconnected: (listener) => {dropped=listener;return () => {dropped=undefined;};},
      };
      return link;
    },
  };
  return { port, device, setAllowed: (v:boolean)=>{allowed=v;}, setEnabled:(v:boolean)=>{enabled=v;},
    disconnect: () => dropped?.("Connection lost"),
    metrics: () => ({connects,scans,cancelCalls,disconnectCalls}) };
}
describe("Pen pairing and verified-ready controller", () => {
  it("asks for OS access, scans devices and never fabricates readiness", async () => {
    const f=fakePort(), c=createPenConnectionController(f.port);
    expect(c.state.getState().kind).toBe("idle");
    await c.begin();
    expect(c.state.getState()).toMatchObject({kind:"found",devices:[f.device]});
    await c.connect(f.device.id);
    expect(c.state.getState().kind).toBe("linked");
    c.verifyNativeInput({tracked:true,evidence:"visionos-spatial-stream",deviceId:f.device.id});
    expect(c.state.getState().kind).toBe("linked");
    c.verifyNativeInput({tracked:true,evidence:"verified-pen-protocol",deviceId:"wrong"});
    expect(c.state.getState().kind).toBe("linked");
    c.verifyNativeInput({tracked:true,evidence:"verified-pen-protocol",deviceId:f.device.id});
    expect(c.state.getState().kind).toBe("ready");
    c.verifyNativeInput({tracked:false,evidence:"verified-pen-protocol",deviceId:f.device.id});
    expect(c.state.getState().kind).toBe("linked");
    f.disconnect();
    expect(c.state.getState()).toMatchObject({kind:"error",code:"disconnected"});
    c.dispose();
  });
  it("never scans or pairs after denied permissions", async () => {
    const f=fakePort(), c=createPenConnectionController(f.port);
    f.setAllowed(false); await c.begin();
    expect(c.state.getState()).toMatchObject({kind:"error",code:"permission"});
    expect(f.metrics().scans).toBe(0); expect(f.metrics().connects).toBe(0); c.dispose();
  });
  it("does not claim connection if Bluetooth remains disabled", async () => {
    const f=fakePort(), c=createPenConnectionController(f.port);
    f.setEnabled(false); await c.begin();
    expect(c.state.getState()).toMatchObject({kind:"error",code:"disabled"});
    expect(f.metrics().scans).toBe(0); c.dispose();
  });
  it("rejects invented device IDs", async () => {
    const f=fakePort(), c=createPenConnectionController(f.port);
    await c.begin(); await c.connect("fake:muse");
    expect(c.state.getState()).toMatchObject({kind:"error",code:"unsupported"});
    expect(f.metrics().connects).toBe(0); c.dispose();
  });
  it("visionOS uses system pairing until native tracking reports ready", async () => {
    const c=createPenConnectionController({mode:"system-spatial",deviceName:"Logitech Muse",pairingInstructions:["Press pen top + primary 3s","Settings > Bluetooth"]});
    await c.begin();
    expect(c.state.getState().kind).toBe("system-pairing");
    c.verifyNativeInput({tracked:true,evidence:"verified-pen-protocol"});
    expect(c.state.getState().kind).toBe("system-pairing");
    c.verifyNativeInput({tracked:true,evidence:"visionos-spatial-stream"});
    expect(c.state.getState()).toMatchObject({kind:"ready",device:{name:"Logitech Muse"}});
    c.verifyNativeInput({tracked:false,evidence:"visionos-spatial-stream"});
    expect(c.state.getState().kind).toBe("system-pairing"); c.dispose();
  });
  it("cancel/dispose ignores a late scan result", async () => {
    let resolveScan: ((devices: readonly {id:string;name:string}[])=>void)|undefined;
    let stopped=0;
    const port: BlePenPort = {mode:"bluetooth-le",requestAccess:async()=>true,
      ensureEnabled:async()=>true,scan:()=>new Promise(resolve=>{resolveScan=resolve;}),
      cancelScan:()=>{stopped++;},connect:async()=>({disconnect:async()=>{}})};
    const c=createPenConnectionController(port), pending=c.begin();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await c.cancel(); resolveScan?.([{id:"late",name:"Late peripheral"}]); await pending;
    expect(c.state.getState().kind).toBe("idle"); c.dispose();
    expect(stopped).toBeGreaterThan(0);
  });
  it("releases a GATT link exactly once when the peripheral disconnects unexpectedly", async () => {
    const f = fakePort();
    const controller = createPenConnectionController(f.port);
    await controller.begin();
    await controller.connect(f.device.id);
    f.disconnect();
    expect(controller.state.getState()).toMatchObject({
      kind: "error", code: "disconnected",
    });
    expect(f.metrics().disconnectCalls).toBe(1);
    await controller.cancel();
    expect(f.metrics().disconnectCalls).toBe(1);
    controller.dispose();
    expect(f.metrics().disconnectCalls).toBe(1);
  });
  it("keeps an established link until explicit cancel and disconnects once", async () => {
    const f=fakePort(), c=createPenConnectionController(f.port);
    await c.begin(); await c.connect(f.device.id); await c.cancel();
    expect(c.state.getState().kind).toBe("idle");
    expect(f.metrics().disconnectCalls).toBe(1); c.dispose();
  });
});
