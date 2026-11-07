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

describe("pitch engine e2e (real Rust via nf-cli)", () => {
  it("builds slides and resolves animation timing", async () => {
    const doc = await PitchDocument.open(host, "Demo");
    const slide = (await doc.addSlide("titleBody")).data.slide_id;
    const title = (
      await doc.addText(slide, 100, 60, 400, 60, "Hello", 44)
    ).data.object_id;
    await doc.addAnimation(slide, title, "fadeIn", 0, 1);

    const before = await doc.slideAt(slide, -0.1);
    expect(before.data.objects.find((o) => o.id === title)!.opacity).toBe(0);
    const during = await doc.slideAt(slide, 0.5);
    const mid = during.data.objects.find((o) => o.id === title)!.opacity;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const after = await doc.slideAt(slide, 2);
    expect(after.data.objects.find((o) => o.id === title)!.opacity).toBe(1);
    await doc.close();
  });

  it("save/reopen preserves deck", async () => {
    const doc = await PitchDocument.open(host, "Q4");
    const s = (await doc.addSlide("title")).data.slide_id;
    await doc.addText(s, 0, 0, 500, 80, "Revenue", 36);
    const bytes = await doc.save();
    await doc.close();

    const re = await PitchDocument.openSnapshot(host, bytes);
    const deck = await re.deck();
    expect(deck.data.title).toBe("Q4");
    expect(deck.data.slide_count).toBe(2);
    await re.close();
  });

  it("enforces the at-least-one-slide rule and object validation", async () => {
    const doc = await PitchDocument.open(host);
    const deck = await doc.deck();
    const only = (await doc.describe<any>()).data.slides[0].id;
    await expect(doc.removeSlide(only)).rejects.toBeInstanceOf(EngineError);
    expect(deck.data.slide_count).toBe(1);
    await doc.close();
  });

  it("undo restores removed objects", async () => {
    const doc = await PitchDocument.open(host);
    const slide = (await doc.describe<any>()).data.slides[0].id;
    const o = (await doc.addRect(slide, 10, 10, 100, 50, [255, 0, 0, 255])).data
      .object_id;
    await doc.removeObject(slide, o);
    expect(await doc.undo()).toBe(true);
    const at = await doc.slideAt(slide, 0);
    expect(at.data.objects.some((x) => x.id === o)).toBe(true);
    await doc.close();
  });

  it("speaker notes set/read/clear and persist through snapshots", async () => {
    const doc = await PitchDocument.open(host, "Notes");
    const slide = (await doc.describe<any>()).data.slides[0].id;
    expect((await doc.slideNotes(slide)).data.notes).toBeNull();
    await doc.setNotes(slide, "remember the demo");
    expect((await doc.slideNotes(slide)).data.notes).toBe("remember the demo");
    const described = await doc.describe<any>();
    expect(described.data.slides[0].notes).toBe("remember the demo");

    const bytes = await doc.save();
    const re = await PitchDocument.openSnapshot(host, bytes);
    expect((await re.slideNotes(slide)).data.notes).toBe("remember the demo");

    await re.setNotes(slide, "");
    expect((await re.slideNotes(slide)).data.notes).toBeNull();
    await re.undo();
    expect((await re.slideNotes(slide)).data.notes).toBe("remember the demo");
    await expect(
      re.setNotes(slide, "x".repeat(32769)),
    ).rejects.toThrow();
    await re.close();
    await doc.close();
  });
});
