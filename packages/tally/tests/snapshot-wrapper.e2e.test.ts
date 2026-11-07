import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

/** Decode the NFD1 envelope (magic + format tag + u32 LE length + payload). */
function envelopePayload(bytes: Uint8Array): unknown {
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("NFD1");
  expect(bytes[4]).toBe(0);
  const len = new DataView(bytes.buffer, bytes.byteOffset + 5, 4).getUint32(0, true);
  expect(bytes.length - 9).toBe(len);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(9)));
}

describe("tally versioned snapshot wrapper (real Rust via nf-cli)", () => {
  it("wraps the snapshot when durable sheet fields are present and restores them", async () => {
    const doc = await TallyDocument.open(host);
    await doc.setCell("A1", "7");
    await doc.setSheetColor(0, "accent");
    await doc.protectSheet(0, true);
    const info = await doc.workbook();
    expect(info.data.sheets[0]).toMatchObject({ tone: "accent", is_protected: true });

    const bytes = await doc.save();
    await doc.close();

    // The payload is the versioned wrapper, not a bare Workbook.
    const payload = envelopePayload(bytes) as Record<string, unknown>;
    expect(payload.kind).toBe("tally");
    expect(payload.schema).toBe(1);
    expect((payload.document as Record<string, unknown>).sheets).toBeInstanceOf(Array);
    expect(payload.sheets).toBeUndefined();

    const restored = await TallyDocument.openSnapshot(host, bytes);
    try {
      const back = await restored.workbook();
      expect(back.data.sheets[0]).toMatchObject({ tone: "accent", is_protected: true });
      expect((await restored.getCell("A1")).data.computed).toBe(7);
      // Protection survives too: editing the sheet is still rejected.
      await expect(restored.setCell("A2", "x")).rejects.toThrow();
    } finally {
      await restored.close();
    }
  });

  it("keeps a plain workbook snapshot in the legacy unwrapped shape", async () => {
    const doc = await TallyDocument.open(host);
    await doc.setCell("B2", "plain");
    const bytes = await doc.save();
    await doc.close();

    const payload = envelopePayload(bytes) as Record<string, unknown>;
    expect(payload.kind).toBeUndefined();
    expect(payload.sheets).toBeInstanceOf(Array);
    expect(payload.document).toBeUndefined();
  });
});
