import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { runExport, runImport, importFormatFor, describeFormat } from "@nitro-forge/ignition/transfer";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

import { SpliceDocument } from "../src/index";
import { SPLICE_EXPORT_FORMATS } from "../src/transfer";

describe("splice render-plan export (real Rust via nf-cli)", () => {
  it("exports the engine render plan as JSON", async () => {
    const s = await SpliceDocument.open(host);
    const src = (await s.addSource(10, "clip")).data.source_id;
    const tr = (await s.addTrack("video")).data.track_id;
    await s.addClip({ track: tr, source: src, in_s: 0, out_s: 4 });
    const out = await runExport(s.handle, SPLICE_EXPORT_FORMATS, { formatId: "render-plan", filename: "cut" });
    expect(out.filename).toBe("cut.json");
    const body = JSON.parse(new TextDecoder().decode(out.bytes));
    expect(body.format).toBe("nitro-forge.render-plan");
    expect(body.plan.tracks).toHaveLength(1);
    await s.close();
  });
});
