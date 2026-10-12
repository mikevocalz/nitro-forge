import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "../src/base64";
import { CliHost } from "../src/host-cli";
import { DocumentHandle } from "../src/document";
import { EngineError } from "../src/types";

describe("base64 codec", () => {
  it("round-trips arbitrary bytes", () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([255, 128, 64]),
      new Uint8Array(Array.from({ length: 1024 }, (_, i) => i % 256)),
    ];
    for (const c of cases) {
      expect([...base64ToBytes(bytesToBase64(c))]).toEqual([...c]);
    }
  });
});

describe("CliHost protocol", () => {
  let host: CliHost;
  beforeAll(() => {
    host = new CliHost();
  });
  afterAll(async () => {
    await host.dispose();
  });

  it("opens an engine, applies a command, closes", async () => {
    const doc = await DocumentHandle.open(host, "tally");
    const res = await doc.apply<{ ok: boolean }>("new", {});
    expect(res.data.ok).toBe(true);
    expect(res.events.map((e) => e.kind)).toContain("document:changed");
    await doc.close();
  });

  it("rejects unknown engines and unknown ops", async () => {
    const h = await host.open("tally");
    await expect(
      host.apply(h, { op: "nonsense_op" }),
    ).rejects.toBeInstanceOf(EngineError);
    await host.close(h);
  });

  it("emits document:restored to listeners", async () => {
    const doc = await DocumentHandle.open(host, "tally");
    await doc.apply("new", {});
    const seen: string[] = [];
    const off = doc.on((e) => seen.push(e.kind));
    const bytes = await doc.snapshot();
    await doc.apply("setCell", { addr: "A1", value: "9" });
    await doc.restore(bytes);
    expect(seen).toContain("document:restored");
    off();
    await doc.close();
  });
});
