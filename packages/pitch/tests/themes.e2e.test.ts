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

describe("pitch deck themes e2e (real Rust via nf-cli)", () => {
  it("runs theme CRUD, deck binding and round-trips through save/reopen", async () => {
    const doc = await PitchDocument.open(host, "Deck");

    const t = (
      await doc.addTheme(
        "Brand",
        { accent1: [10, 20, 30, 255], dk1: [1, 2, 3, 255] },
        { major_latin: "Inter", minor_latin: "Inter" },
      )
    ).data.theme_id;
    const spare = (await doc.addTheme("Spare")).data.theme_id;

    await doc.setThemeColor(t, "accent2", [200, 100, 50, 255]);
    await doc.setThemeFont(t, "minor_latin", "Georgia");
    await doc.renameTheme(t, "Brand v2");
    await doc.setDeckTheme(t);

    const bound = (await doc.deckTheme()).data;
    expect(bound.theme_id).toBe(t);
    expect(bound.theme).toMatchObject({
      id: t,
      name: "Brand v2",
      colors: { accent1: [10, 20, 30, 255], accent2: [200, 100, 50, 255] },
      fonts: { major_latin: "Inter", minor_latin: "Georgia" },
    });

    const described = (await doc.describe<any>()).data;
    expect(described.themes).toHaveLength(2);
    expect(described.deck_theme).toBe(t);

    // Undo the binding, then redo it — history covers theme state.
    await doc.undo();
    expect((await doc.deckTheme()).data.theme_id).toBeNull();
    await doc.redo();
    expect((await doc.deckTheme()).data.theme_id).toBe(t);

    const bytes = await doc.save();
    await doc.close();

    const re = await PitchDocument.openSnapshot(host, bytes);
    const state = (await re.describe<any>()).data;
    expect(state.themes).toHaveLength(2);
    expect(state.deck_theme).toBe(t);
    expect(state.themes[0].fonts.minor_latin).toBe("Georgia");
    const reBound = (await re.deckTheme()).data;
    expect(reBound.theme?.name).toBe("Brand v2");
    await re.close();
    void spare;
  });

  it("clears slot values and the deck binding; removing the bound theme clears it", async () => {
    const doc = await PitchDocument.open(host);
    const a = (await doc.addTheme("A", { dk1: [9, 9, 9, 255] })).data.theme_id;
    const b = (await doc.addTheme("B")).data.theme_id;
    await doc.setDeckTheme(a);

    await doc.setThemeColor(a, "dk1", null);
    await doc.setThemeFont(a, "major_latin", null);
    let bound = (await doc.deckTheme()).data;
    expect(bound.theme?.colors).toEqual({});

    await doc.removeTheme(b);
    bound = (await doc.deckTheme()).data;
    expect(bound.theme_id).toBe(a);

    await doc.removeTheme(a);
    bound = (await doc.deckTheme()).data;
    expect(bound.theme_id).toBeNull();
    expect(bound.theme).toBeNull();
    const state = (await doc.describe<any>()).data;
    expect(state.themes).toHaveLength(0);
    await doc.close();
  });

  it("rejects invalid payloads atomically", async () => {
    const doc = await PitchDocument.open(host);

    await expect(doc.addTheme("")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addTheme("x".repeat(129))).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addTheme("bad", { bogus: [0, 0, 0, 255] } as never),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addTheme("bad", { accent1: [256, 0, 0, 255] }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.addTheme("bad", undefined, { major_latin: "  " }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(
      doc.setDeckTheme(424242),
    ).rejects.toBeInstanceOf(EngineError);

    const t = (await doc.addTheme("T")).data.theme_id;
    await expect(doc.setThemeColor(t, "bogus" as never, null)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setThemeFont(t, "bogus" as never, "x")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setThemeFont(t, "major_latin", "  ")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.renameTheme(424242, "x")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.removeTheme(424242)).rejects.toBeInstanceOf(EngineError);

    // Failed ops left no trace: exactly one theme, unbound.
    const state = (await doc.describe<any>()).data;
    expect(state.themes).toHaveLength(1);
    expect(state.deck_theme).toBeUndefined();
    await doc.close();
  });
});
