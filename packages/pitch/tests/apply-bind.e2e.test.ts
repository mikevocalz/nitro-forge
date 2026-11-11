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

describe("pitch masters/layouts apply-bind e2e (real Rust via nf-cli)", () => {
  it("resolves the slide→layout→master→theme chain via slideLayout", async () => {
    const doc = await PitchDocument.open(host, "Deck");
    const slide = (await doc.describe<any>()).data.slides[0].id as number;

    const m = (await doc.addMaster("Corporate", [1, 2, 3, 255])).data.master_id;
    const l = (await doc.addLayout(m, "Title Slide")).data.layout_id;
    const titlePh = (
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
    const bodyPh = (
      await doc.addPlaceholder(l, {
        kind: "body",
        x: 40,
        y: 120,
        w: 880,
        h: 300,
        label: "Body",
      })
    ).data.placeholder_id;
    const theme = (await doc.addTheme("Brand", { accent1: [9, 8, 7, 255] })).data.theme_id;
    await doc.setDeckTheme(theme);
    await doc.setSlideLayout(slide, l);

    const titleObj = (await doc.addText(slide, 40, 20, 880, 80, "Q3 numbers")).data.object_id;
    const bodyObj = (await doc.addText(slide, 40, 120, 880, 300, "Details")).data.object_id;
    await doc.setObjectPlaceholder(slide, titleObj, titlePh);
    await doc.setObjectPlaceholder(slide, bodyObj, bodyPh);

    const resolved = (await doc.slideLayout(slide)).data;
    expect(resolved.slide).toBe(slide);
    expect(resolved.layout_id).toBe(l);
    expect(resolved.layout?.name).toBe("Title Slide");
    expect(resolved.master_id).toBe(m);
    expect(resolved.master?.name).toBe("Corporate");
    expect(resolved.theme_id).toBe(theme);
    expect(resolved.theme?.name).toBe("Brand");
    // Effective background falls back to the master's stored color.
    expect(resolved.background).toEqual([1, 2, 3, 255]);
    expect(resolved.placeholders).toHaveLength(2);
    expect(resolved.placeholders[0]).toMatchObject({
      id: titlePh,
      kind: "title",
      inherit_theme: true,
      objects: [titleObj],
    });
    expect(resolved.placeholders[1]).toMatchObject({
      id: bodyPh,
      kind: "body",
      objects: [bodyObj],
    });

    // describe exposes the stored object→placeholder binding.
    const described = (await doc.describe<any>()).data;
    expect(described.slides[0].objects[0].placeholder_id).toBe(titlePh);
    expect(described.slides[0].objects[1].placeholder_id).toBe(bodyPh);

    // Slide-level background overrides the master in the resolution.
    await doc.setBackground(slide, [200, 200, 200, 255]);
    expect((await doc.slideLayout(slide)).data.background).toEqual([200, 200, 200, 255]);

    // Undo the background, then the body bind — history covers bindings.
    await doc.undo();
    await doc.undo();
    let state = (await doc.describe<any>()).data;
    expect(state.slides[0].objects[1].placeholder_id).toBeUndefined();
    expect(state.slides[0].objects[0].placeholder_id).toBe(titlePh);
    await doc.redo();
    await doc.redo();
    state = (await doc.describe<any>()).data;
    expect(state.slides[0].objects[1].placeholder_id).toBe(bodyPh);

    // Bound objects force the schema:8 snapshot wrapper and round-trip.
    const bytes = await doc.save();
    await doc.close();
    const re = await PitchDocument.openSnapshot(host, bytes);
    const resolved2 = (await re.slideLayout(slide)).data;
    expect(resolved2.placeholders[0]!.objects).toEqual([titleObj]);
    expect(resolved2.placeholders[1]!.objects).toEqual([bodyObj]);
    expect(resolved2.background).toEqual([200, 200, 200, 255]);
    await re.close();
  });

  it("clears placeholder tags on rebind/removal and rejects invalid binds", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id as number;
    const m = (await doc.addMaster("M")).data.master_id;
    const l1 = (await doc.addLayout(m, "L1")).data.layout_id;
    const l2 = (await doc.addLayout(m, "L2")).data.layout_id;
    const ph1 = (
      await doc.addPlaceholder(l1, { kind: "title", x: 0, y: 0, w: 10, h: 10, label: "T" })
    ).data.placeholder_id;
    const ph2 = (
      await doc.addPlaceholder(l2, { kind: "body", x: 0, y: 0, w: 10, h: 10, label: "B" })
    ).data.placeholder_id;
    const obj = (await doc.addText(slide, 0, 0, 10, 10, "x")).data.object_id;

    // Unbound slide cannot take a tag; unknown ids reject atomically.
    await expect(doc.setObjectPlaceholder(slide, obj, ph1)).rejects.toBeInstanceOf(EngineError);
    await doc.setSlideLayout(slide, l1);
    await expect(doc.setObjectPlaceholder(slide, obj, ph2)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setObjectPlaceholder(slide, obj, 424242)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setObjectPlaceholder(slide, 424242, null)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setObjectPlaceholder(424242, obj, null)).rejects.toBeInstanceOf(EngineError);

    await doc.setObjectPlaceholder(slide, obj, ph1);
    // Equal re-tag is an eventless no-op.
    const before = await doc.save();
    await doc.setObjectPlaceholder(slide, obj, ph1);
    expect(await doc.save()).toEqual(before);

    // Rebinding to another layout clears the tag.
    await doc.setSlideLayout(slide, l2);
    let state = (await doc.describe<any>()).data;
    expect(state.slides[0].layout_id).toBe(l2);
    expect(state.slides[0].objects[0].placeholder_id).toBeUndefined();
    // The tag can move to the new layout's placeholder.
    await doc.setObjectPlaceholder(slide, obj, ph2);
    // Clearing the binding clears tags too.
    await doc.setSlideLayout(slide, null);
    state = (await doc.describe<any>()).data;
    expect(state.slides[0].objects[0].placeholder_id).toBeUndefined();

    // removePlaceholder clears tags on slides bound to that layout.
    await doc.setSlideLayout(slide, l1);
    await doc.setObjectPlaceholder(slide, obj, ph1);
    await doc.removePlaceholder(l1, ph1);
    state = (await doc.describe<any>()).data;
    expect(state.slides[0].objects[0].placeholder_id).toBeUndefined();
    expect(state.slides[0].layout_id).toBe(l1);

    // removeLayout clears binding + tags; one undo restores both.
    await doc.setSlideLayout(slide, l2);
    await doc.setObjectPlaceholder(slide, obj, ph2);
    await doc.removeLayout(l2);
    state = (await doc.describe<any>()).data;
    expect(state.slides[0].layout_id).toBeUndefined();
    expect(state.slides[0].objects[0].placeholder_id).toBeUndefined();
    await doc.undo();
    state = (await doc.describe<any>()).data;
    expect(state.slides[0].layout_id).toBe(l2);
    expect(state.slides[0].objects[0].placeholder_id).toBe(ph2);

    // Unbound slideLayout read is graceful; deck theme still resolves.
    const resolved = (await doc.slideLayout(slide)).data;
    expect(resolved.layout).not.toBeNull();
    expect(resolved.placeholders[0]!.objects).toEqual([obj]);
    await doc.close();
  });
});
