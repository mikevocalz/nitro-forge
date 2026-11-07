import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PrismDocument } from "@nitro-forge/prism";
import { instrumentHost } from "../src/index";
import { createTestTelemetry } from "../src/testing";

// Real Rust Prism engine through nf-cli, wrapped by instrumentHost. Proves
// the wrapper is transparent to a real document flow and records it; it is
// not a device or Nitro JSI run.
let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("instrumentHost over the real Prism engine", () => {
  it("records a paint, save and reopen flow without changing results", async () => {
    const tt = createTestTelemetry();
    const instrumented = instrumentHost(host, tt.telemetry);
    const doc = await PrismDocument.open(instrumented, 4, 4);
    const layer = (await doc.addRasterLayer("Private layer name")).data.layer_id;
    await doc.fillLayer(layer, [0, 0, 255, 255]);
    const bytes = await doc.save();
    await doc.close();
    const reopened = await PrismDocument.openSnapshot(instrumented, bytes);
    const desc = await reopened.describe<{ layers: unknown[] }>();
    expect(desc.data.layers).toHaveLength(1);
    await reopened.close();

    const applied = tt.spans("engine.apply");
    expect(applied.length).toBeGreaterThanOrEqual(3);
    expect(applied.every(s => s.attrs.engine === "prism" && s.outcome === "ok")).toBe(true);
    expect(tt.spans("engine.snapshot")).toHaveLength(1);
    expect(JSON.stringify(tt.events())).not.toContain("Private layer name");
  });

  it("records a real engine rejection with its code and rethrows it", async () => {
    const tt = createTestTelemetry();
    const instrumented = instrumentHost(host, tt.telemetry);
    const doc = await PrismDocument.open(instrumented, 2, 2);
    await expect(instrumented.apply(doc.handle.id, { op: "no_such_op" })).rejects.toBeInstanceOf(EngineError);
    const failure = tt.failures("engine.apply")[0];
    expect(failure?.attrs).toEqual({ engine: "prism", op: "no_such_op" });
    expect(["invalid_command", "unsupported"]).toContain(failure?.code);
    await doc.close();
  });
});
