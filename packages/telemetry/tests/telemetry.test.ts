import { describe, expect, it } from "vitest";
import { EngineError, type EngineHost } from "@nitro-forge/ignition";
import { createTelemetry, instrumentHost, redactAttributes, scrubMessage } from "../src/index";
import { createTestTelemetry } from "../src/testing";

describe("consent", () => {
  it("does not resurrect spans after consent is revoked and restored", () => {
    const t = createTelemetry({ consent: "local" });
    const span = t.span("engine.apply");
    t.setConsent("off");
    t.setConsent("local");
    span.end();
    expect(t.exportTrace().events).toEqual([]);
  });

  it("flush waits for automatically dispatched sink work", async () => {
    let complete!: () => void;
    const t = createTelemetry({ consent: "diagnostics", batchSize: 1,
      sink: () => new Promise<void>(resolve => { complete = resolve; }) });
    t.trace("ready");
    let settled = false;
    const flushed = t.flush().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await flushed;
    expect(settled).toBe(true);
  });

  it("validates bounds and protects retained events from consumer mutation", () => {
    expect(() => createTelemetry({ consent: "off", maxEvents: 0 })).toThrow(RangeError);
    expect(() => createTelemetry({ consent: "local", batchSize: Infinity })).toThrow(RangeError);
    const t = createTelemetry({ consent: "local" });
    t.trace("ready", { count: 1 });
    const event = t.exportTrace().events[0]!;
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.attrs)).toBe(true);
  });
  it("records nothing under off, keeps local events on the device, sends only under diagnostics", async () => {
    const sent: unknown[] = [];
    const t = createTelemetry({ consent: "off", sink: b => void sent.push(...b), batchSize: 1 });
    t.span("engine.apply", { op: "fill" }).end();
    t.trace("boot");
    expect(t.exportTrace().events).toEqual([]);

    t.setConsent("local");
    t.trace("boot");
    expect(t.exportTrace().events).toHaveLength(1);
    expect(sent).toEqual([]);

    t.setConsent("diagnostics");
    t.trace("ready");
    await t.flush();
    expect(sent).toHaveLength(1);
  });

  it("turning consent off clears the buffer; turning it down drops the unsent queue", async () => {
    const sent: unknown[] = [];
    const t = createTelemetry({ consent: "diagnostics", sink: b => void sent.push(...b) });
    t.trace("a");
    t.setConsent("local");
    await t.flush();
    expect(sent).toEqual([]);
    t.setConsent("off");
    expect(t.exportTrace()).toMatchObject({ consent: "off", events: [], overflowed: 0 });
  });
});

describe("privacy", () => {
  it("drops attributes that could carry document text", () => {
    const { attrs, dropped } = redactAttributes({ op: "set_text", engine: "quill", bytes: 12, ok: true,
      text: "Dear Ms. Alvarez, the contract…", nan: Number.NaN, "bad key": "x" });
    expect(attrs).toEqual({ op: "set_text", engine: "quill", bytes: 12, ok: true });
    expect(dropped).toBe(3);
  });

  it("scrubs quoted text, paths, URLs and long numbers from failure messages", () => {
    expect(scrubMessage('cell "Q3 revenue: 1200000" not found in /Users/ana/Docs/budget.nfd via https://x.y/z id 123456'))
      .toBe("cell <text> not found in <path> via <url> id <n>");
  });

  it("keeps failure messages on the device and sends only the code", async () => {
    const tt = createTestTelemetry();
    tt.telemetry.failure("engine.apply", new EngineError({ code: "validation", message: 'bad name "Secret plan"', recoverable: true }));
    await tt.telemetry.flush();
    expect(tt.failures()[0]).toMatchObject({ code: "validation", recoverable: true, message: "bad name <text>" });
    expect(tt.sent()[0]).toMatchObject({ type: "failure", code: "validation" });
    expect(tt.sent()[0]).not.toHaveProperty("message");
  });

  it("rejects event names that are not identifiers", () => {
    const t = createTelemetry({ consent: "local" });
    expect(() => t.trace("user typed: hello")).toThrow(/look like identifiers/);
  });
});

describe("timings and buffer", () => {
  it("times spans on the clock, ends each once, and bounds the buffer", () => {
    let now = 0;
    const t = createTelemetry({ consent: "local", clock: () => now, maxEvents: 2 });
    const s = t.span("render.frame");
    now = 16;
    s.end();
    s.end("error");
    t.trace("a");
    t.trace("b");
    const out = t.exportTrace();
    expect(out.events.map(e => e.name)).toEqual(["a", "b"]);
    expect(out.overflowed).toBe(1);
  });

  it("time() records an error span and a failure, then rethrows", async () => {
    const tt = createTestTelemetry();
    await expect(tt.telemetry.time("export.render", { format: "png" }, async () => {
      tt.advance(40);
      throw new RangeError("too big");
    })).rejects.toThrow("too big");
    expect(tt.spans("export.render")[0]).toMatchObject({ outcome: "error", durationMs: 40, attrs: { format: "png" } });
    expect(tt.failures("export.render")[0]).toMatchObject({ code: "RangeError" });
  });

  it("a failing sink never fails the app", async () => {
    const t = createTelemetry({ consent: "diagnostics", batchSize: 1, sink: () => Promise.reject(new Error("offline")) });
    t.trace("a");
    await expect(t.flush()).resolves.toBeUndefined();
  });
});

describe("instrumentHost", () => {
  function fakeHost(): EngineHost {
    return {
      open: async () => 7,
      apply: async <T>(_h: number, cmd: { op: string }) => {
        if (cmd.op === "explode") throw new EngineError({ code: "invalid_command", message: "unknown op", recoverable: false });
        return { data: { ok: true } as T, events: [{ kind: "document:changed" }] };
      },
      snapshot: async () => new Uint8Array(32),
      restore: async () => {},
      undo: async () => true,
      redo: async () => false,
      close: async () => true,
      dispose: async () => {},
    };
  }

  it("times every call, tags engine and op, and passes results and errors through unchanged", async () => {
    const tt = createTestTelemetry();
    const host = instrumentHost(fakeHost(), tt.telemetry);
    const handle = await host.open("tally");
    const result = await host.apply(handle, { op: "set_cell", payload: { text: "private" } });
    expect(result.events).toHaveLength(1);
    await expect(host.apply(handle, { op: "explode" })).rejects.toBeInstanceOf(EngineError);
    expect((await host.snapshot(handle)).byteLength).toBe(32);
    expect(await host.undo(handle)).toBe(true);
    await host.close(handle);

    expect(tt.spans("engine.apply").map(s => [s.attrs.op, s.outcome])).toEqual([["set_cell", "ok"], ["explode", "error"]]);
    expect(tt.spans("engine.apply")[0]?.attrs.engine).toBe("tally");
    expect(tt.failures("engine.apply")[0]).toMatchObject({ code: "invalid_command", attrs: { engine: "tally", op: "explode" } });
    expect(JSON.stringify(tt.events())).not.toContain("private");
    expect(tt.spans().map(s => s.name)).toEqual(["engine.open", "engine.apply", "engine.apply", "engine.snapshot", "engine.undo", "engine.close"]);
  });
});
