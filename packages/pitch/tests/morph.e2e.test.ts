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

describe("pitch morph transitions e2e (real Rust via nf-cli)", () => {
  it("tags objects across slides, stores the morph transition and round-trips", async () => {
    const doc = await PitchDocument.open(host, "Morph deck");
    const described = (await doc.describe<any>()).data;
    const s1 = described.slides[0].id as number;
    const s2 = (await doc.addSlide("blank")).data.slide_id;

    const a1 = (await doc.addRect(s1, 0, 0, 100, 100, [255, 0, 0, 255])).data.object_id;
    const a2 = (await doc.addText(s2, 0, 0, 100, 40, "morph target")).data.object_id;

    await doc.setMorphName(s1, a1, "hero");
    await doc.setMorphName(s2, a2, "hero");
    await doc.setSlideTransition(s2, { kind: "morph", duration_ms: 800 });

    const after = (await doc.describe<any>()).data;
    expect(after.slides[0].objects[0].morph_name).toBe("hero");
    expect(after.slides[1].objects[0].morph_name).toBe("hero");
    expect(after.slides[1].transition).toEqual({ kind: "morph", duration_ms: 800 });

    const bytes = await doc.save();
    const re = await PitchDocument.openSnapshot(host, bytes);
    const reopened = (await re.describe<any>()).data;
    expect(reopened.slides[0].objects[0].morph_name).toBe("hero");
    expect(reopened.slides[1].transition.kind).toBe("morph");

    await re.clearMorphName(s2, a2);
    const cleared = (await re.describe<any>()).data;
    expect(cleared.slides[1].objects[0].morph_name).toBeUndefined();
    await re.close();
    await doc.close();
  });

  it("rejects duplicate morph names on one slide and invalid tags atomically", async () => {
    const doc = await PitchDocument.open(host);
    const s1 = (await doc.describe<any>()).data.slides[0].id as number;
    const a = (await doc.addText(s1, 0, 0, 100, 40, "one")).data.object_id;
    const b = (await doc.addText(s1, 0, 50, 100, 40, "two")).data.object_id;

    await doc.setMorphName(s1, a, "shared");
    await expect(doc.setMorphName(s1, b, "shared")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setMorphName(s1, a, "   ")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setMorphName(s1, 99999, "ghost")).rejects.toBeInstanceOf(EngineError);

    // the failed writes left state untouched: a still owns "shared", b has none
    const described = (await doc.describe<any>()).data;
    const objects = described.slides[0].objects;
    expect(objects.find((o: any) => o.id === a).morph_name).toBe("shared");
    expect(objects.find((o: any) => o.id === b).morph_name).toBeUndefined();
    await doc.close();
  });
});
