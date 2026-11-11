import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PitchDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("pitch masters/layouts/placeholders e2e (real Rust via nf-cli)", () => {
  it("runs the full CRUD lifecycle and round-trips through save/reopen", async () => {
    const doc = await PitchDocument.open(host, "Deck");
    const slide = (await doc.describe<any>()).data.slides[0].id as number;

    const m = (await doc.addMaster("Corporate", [10, 20, 30, 255])).data.master_id;
    const l = (await doc.addLayout(m, "Title Slide")).data.layout_id;
    const ph = (
      await doc.addPlaceholder(l, {
        kind: "title",
        x: 40,
        y: 20,
        w: 880,
        h: 80,
        label: "Deck title",
        inherit_theme: true,
      })
    ).data.placeholder_id;

    await doc.renameMaster(m, "Brand");
    await doc.setMasterBackground(m, null);
    await doc.renameLayout(l, "Cover");
    await doc.updatePlaceholder(l, ph, { kind: "body", h: 120 });
    await doc.setSlideLayout(slide, l);

    const described = (await doc.describe<any>()).data;
    expect(described.masters).toHaveLength(1);
    expect(described.masters[0]).toMatchObject({ id: m, name: "Brand" });
    expect(described.layouts[0]).toMatchObject({ id: l, master_id: m, name: "Cover" });
    expect(described.layouts[0].placeholders[0]).toMatchObject({
      id: ph,
      kind: "body",
      h: 120,
      label: "Deck title",
      inherit_theme: true,
    });
    expect(described.slides[0].layout_id).toBe(l);

    // Undo the binding, then redo it — history covers masters state.
    await doc.undo();
    expect((await doc.describe<any>()).data.slides[0].layout_id).toBeUndefined();
    await doc.redo();
    expect((await doc.describe<any>()).data.slides[0].layout_id).toBe(l);

    const bytes = await doc.save();
    await doc.close();

    const re = await PitchDocument.openSnapshot(host, bytes);
    const state = (await re.describe<any>()).data;
    expect(state.masters).toHaveLength(1);
    expect(state.layouts).toHaveLength(1);
    expect(state.layouts[0].placeholders).toHaveLength(1);
    expect(state.slides[0].layout_id).toBe(l);
    await re.close();
  });

  it("cascades removal and clears slide bindings without touching slides", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id as number;
    const m = (await doc.addMaster("M")).data.master_id;
    const l = (await doc.addLayout(m, "L")).data.layout_id;
    await doc.setSlideLayout(slide, l);

    await doc.removeLayout(l);
    let state = (await doc.describe<any>()).data;
    expect(state.layouts).toHaveLength(0);
    expect(state.slides).toHaveLength(1);
    expect(state.slides[0].layout_id).toBeUndefined();

    const l2 = (await doc.addLayout(m, "L2")).data.layout_id;
    await doc.setSlideLayout(slide, l2);
    await doc.removeMaster(m);
    state = (await doc.describe<any>()).data;
    expect(state.masters).toHaveLength(0);
    expect(state.layouts).toHaveLength(0);
    expect(state.slides[0].layout_id).toBeUndefined();

    // One undo restores the whole cascade.
    await doc.undo();
    state = (await doc.describe<any>()).data;
    expect(state.layouts).toHaveLength(1);
    expect(state.slides[0].layout_id).toBe(l2);
    await doc.close();
  });

  it("rejects invalid payloads atomically", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id as number;

    await expect(doc.addMaster("")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addMaster("x".repeat(129))).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addLayout(999999, "L")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setSlideLayout(slide, 999999)).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addPlaceholder(999999, { kind: "title", x: 0, y: 0, w: 1, h: 1, label: "a" }),
    ).rejects.toBeInstanceOf(EngineError);

    const m = (await doc.addMaster("M")).data.master_id;
    const l = (await doc.addLayout(m, "L")).data.layout_id;
    await expect(
      doc.addPlaceholder(l, { kind: "bogus" as never, x: 0, y: 0, w: 1, h: 1, label: "a" }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addPlaceholder(l, { kind: "title", x: 0, y: 0, w: 0, h: 1, label: "a" }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.updatePlaceholder(l, 424242, { kind: "body" }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.renameMaster(424242, "x")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.removeLayout(424242)).rejects.toBeInstanceOf(EngineError);

    // Failed ops left no trace: still exactly one master and one layout.
    const state = (await doc.describe<any>()).data;
    expect(state.masters).toHaveLength(1);
    expect(state.layouts).toHaveLength(1);
    expect(state.layouts[0].placeholders).toHaveLength(0);
    await doc.close();
  });
});
