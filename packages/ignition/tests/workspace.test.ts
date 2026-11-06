import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "../src/host-cli";
import {
  PRESET_NAME_MAX,
  WorkspaceError,
  WorkspaceSession,
  type WorkspaceOptions,
  type WorkspaceStore,
} from "../src/workspace";

class MemoryStore implements WorkspaceStore {
  map = new Map<string, string>();
  getString(k: string) {
    return this.map.get(k);
  }
  set(k: string, v: string) {
    this.map.set(k, v);
  }
  remove(k: string) {
    this.map.delete(k);
  }
}

const options = (store: WorkspaceStore): WorkspaceOptions => ({
  storeKey: "tally-studio",
  store,
  modes: [
    { id: "edit", label: "Edit", defaultLayout: { left: ["layers"] } },
    { id: "review", label: "Review", defaultLayout: { right: ["comments"] } },
  ],
  builtInPresets: [
    { id: "edit", name: "Edit", modeId: "edit", layout: { left: ["layers"] } },
    { id: "review", name: "Review", modeId: "review", layout: { right: ["comments"] } },
  ],
});

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("WorkspaceSession (real Rust document via nf-cli)", () => {
  it("keeps one document across modes; an edit in one mode is visible in another", async () => {
    const ws = await WorkspaceSession.open(host, "tally", options(new MemoryStore()));
    const doc = ws.document;
    await doc.apply("new", {});
    await doc.apply("setCell", { addr: "A1", value: "=2+3" });
    ws.setMode("review");
    expect(ws.state.activeModeId).toBe("review");
    expect(ws.document).toBe(doc);
    const cell = await ws.document.apply<{ computed: unknown }>("getCell", { addr: "A1" });
    expect(cell.data.computed).toEqual(5);
    await ws.close();
    await ws.close();
    await expect(doc.apply("describe")).rejects.toThrow(/closed/);
  });

  it("persists per-mode layouts and the active mode across sessions", async () => {
    const store = new MemoryStore();
    const a = await WorkspaceSession.open(host, "tally", options(store));
    a.setLayout("edit", { left: ["layers", "history"] });
    a.setMode("review");
    await a.close();
    const b = await WorkspaceSession.open(host, "tally", options(store));
    expect(b.state.activeModeId).toBe("review");
    expect(b.state.layouts.edit).toEqual({ left: ["layers", "history"] });
    expect(b.state.layouts.review).toEqual({ right: ["comments"] });
    b.resetLayout("edit");
    expect(b.state.layouts.edit).toEqual({ left: ["layers"] });
    await b.close();
  });

  it("custom presets: save, rename, duplicate, delete with undo, validated names", async () => {
    const store = new MemoryStore();
    const ws = await WorkspaceSession.open(host, "tally", options(store));
    ws.setLayout("edit", { left: ["swatches"] });
    const saved = ws.saveAsPreset("  Painting  ");
    expect(saved.state.presets.find((p) => p.id === saved.presetId)?.name).toBe("Painting");
    expect(saved.state.activePresetId).toBe(saved.presetId);
    expect(() => ws.saveAsPreset("painting")).toThrow(WorkspaceError);
    expect(() => ws.saveAsPreset("   ")).toThrow(/empty/);
    expect(() => ws.saveAsPreset("x".repeat(PRESET_NAME_MAX + 1))).toThrow(/longer/);
    expect(() => ws.renamePreset("edit", "Mine")).toThrow(/built in/);
    ws.renamePreset(saved.presetId, "Ink");
    const dup = ws.duplicatePreset(saved.presetId);
    expect(dup.state.presets.find((p) => p.id === dup.presetId)?.name).toBe("Ink copy");
    const del = ws.deletePreset(saved.presetId);
    expect(del.state.presets.some((p) => p.id === saved.presetId)).toBe(false);
    expect(del.state.activePresetId).toBeUndefined();
    ws.restorePreset(del.deleted, del.index);
    expect(ws.state.presets.filter((p) => !p.builtIn).map((p) => p.name)).toEqual(["Ink", "Ink copy"]);
    expect(() => ws.deletePreset("review")).toThrow(/built in/);
    await ws.close();

    const again = await WorkspaceSession.open(host, "tally", options(store));
    expect(again.state.presets.filter((p) => !p.builtIn).map((p) => p.name)).toEqual(["Ink", "Ink copy"]);
    const next = again.saveAsPreset("Third");
    expect(next.presetId).toBe("custom-3");
    await again.close();
  });

  it("selecting and resetting presets switches mode and loads the layout", async () => {
    const ws = await WorkspaceSession.open(host, "tally", options(new MemoryStore()));
    ws.setLayout("review", { right: [] });
    ws.selectPreset("review");
    expect(ws.state.activeModeId).toBe("review");
    expect(ws.state.layouts.review).toEqual({ right: ["comments"] });
    ws.setLayout("review", { right: ["x"] });
    expect(ws.state.activePresetId).toBeUndefined();
    ws.resetPreset("review");
    expect(ws.state.layouts.review).toEqual({ right: ["comments"] });
    await ws.close();
  });

  it("falls back to defaults for corrupt or stale stored state and rejects bad modes", async () => {
    const store = new MemoryStore();
    store.set("tally-studio", "{not json");
    const ws = await WorkspaceSession.open(host, "tally", options(store));
    expect(ws.state.activeModeId).toBe("edit");
    expect(() => ws.setMode("nope")).toThrow(WorkspaceError);
    await ws.close();
    store.set(
      "tally-studio",
      JSON.stringify({ v: 1, activeModeId: "gone", layouts: { gone: 1 }, custom: [{ id: "custom-9", name: "Old", modeId: "gone", layout: {} }], nextCustom: 2 }),
    );
    const ws2 = await WorkspaceSession.open(host, "tally", options(store));
    expect(ws2.state.activeModeId).toBe("edit");
    expect(ws2.state.presets.some((p) => p.name === "Old")).toBe(false);
    await ws2.close();
    expect(() => WorkspaceSession.attach(ws2.document, { ...options(store), modes: [] })).toThrow(WorkspaceError);
  });

  it("notifies subscribers after persisting", async () => {
    const store = new MemoryStore();
    const ws = await WorkspaceSession.open(host, "tally", options(store));
    const seen: string[] = [];
    ws.subscribe((s) => {
      seen.push(s.activeModeId);
      expect(JSON.parse(store.getString("tally-studio") ?? "{}").activeModeId).toBe(s.activeModeId);
    });
    ws.setMode("review");
    expect(seen).toEqual(["review"]);
    await ws.close();
  });
});
