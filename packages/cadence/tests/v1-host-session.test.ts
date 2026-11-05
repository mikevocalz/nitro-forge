import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { ForgeV1EngineHost, type ForgeV1Factory } from "@nitro-forge/ignition/v1-host";
import { CadenceInstrumentSession } from "../src/instrument-session";

let nativeRustHost: CliHost;
beforeAll(() => { nativeRustHost = new CliHost(); });
afterAll(async () => { await nativeRustHost.dispose(); });

describe("generated Nitro v1 wire semantics (Rust CLI-backed structural test)", () => {
  it("translates JSON payloads, events, owned buffers, undo and restore", async () => {
    // This facsimile ONLY adapts a real Rust CLI into the generated v1 shape.
    // Actual on-device C++/Swift/Kotlin v1 registration is still unverified.
    const factory: ForgeV1Factory = {
      open: async kind => {
        const handle = await nativeRustHost.open(kind);
        return {
          kind,
          apply: async command => {
            const result = await nativeRustHost.apply(handle, {
              op: command.op,
              ...(command.v === undefined ? {} : { v: command.v }),
              ...(command.payloadJson === undefined ? {} : {
                payload: JSON.parse(command.payloadJson) as unknown,
              }),
            });
            return {
              dataJson: JSON.stringify(result.data),
              events: result.events.map(event => ({
                kind: event.kind,
                ...(event.detail === undefined ? {} : {
                  detailJson: JSON.stringify(event.detail),
                }),
              })),
            };
          },
          snapshot: async () => Uint8Array.from(await nativeRustHost.snapshot(handle)).buffer,
          restore: bytes => nativeRustHost.restore(handle, new Uint8Array(bytes)),
          undo: () => nativeRustHost.undo(handle),
          redo: () => nativeRustHost.redo(handle),
          close: async () => { await nativeRustHost.close(handle); },
        };
      },
    };
    const bridge = new ForgeV1EngineHost(factory);
    const session = await CadenceInstrumentSession.open(bridge, { trackName: "Nitro v1" });
    expect(session.state.gain).toBe(1);
    await session.setGain(0.36);
    await session.setPan(0.57);
    expect(session.state).toMatchObject({ gain: 0.36, pan: 0.57 });
    expect(await session.undo()).toBe(true);
    expect(session.state.pan).toBe(0);
    expect(await session.redo()).toBe(true);
    expect(session.state.pan).toBe(0.57);
    const bytes = await session.save();
    expect(bytes.byteLength).toBeGreaterThan(20);
    await session.close();
    await expect(bridge.apply(1, { op: "describe" })).rejects.toThrow(/Closed/);
    await bridge.dispose();
  });
});
