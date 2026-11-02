/** Pure dock-layout operations: the editable document and undo history remain in Ignition. */
export const STUDIOS = ["prism", "cadence", "splice", "folio", "pitch", "tally", "quill"] as const;
export type Studio = typeof STUDIOS[number];
export const DOCKS = ["left", "right", "bottom"] as const;
export type Dock = typeof DOCKS[number];
export type Rect = { x: number; y: number; width: number; height: number };
export type Geometry = { width: number; height: number; minStageWidth: number; minStageHeight: number };
export type DockSizes = { leftFraction: number; rightFraction: number; bottomFraction: number };
export type Layout = {
  schemaVersion: 1;
  studioId: Studio;
  docks: Record<Dock, string[]>;
  collapsed: string[];
  activeTabs: Partial<Record<Dock, string>>;
  sizes: DockSizes;
  floating: { panelId: string; rect: Rect }[];
};
export type Reason = "unknown-panel" | "missing-panel" | "invalid-position" | "invalid-geometry" | "no-stage-space";
export type Result = { ok: true; layout: Layout } | { ok: false; layout: Layout; reason: Reason };
const failure = (layout: Layout, reason: Reason): Result => ({ ok: false, layout, reason });
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const panels = (v: unknown, known: ReadonlySet<string>): v is string[] =>
  Array.isArray(v) && v.length <= 40 && v.every((id) =>
    typeof id === "string" && id.length > 0 && id.length <= 80 && known.has(id));
const hasPanel = (l: Layout, id: string): boolean =>
  DOCKS.some((d) => l.docks[d].includes(id)) || l.floating.some((f) => f.panelId === id);
const validRect = (v: unknown): v is Rect => isRecord(v)
  && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.width) && isFiniteNumber(v.height)
  && v.x >= 0 && v.y >= 0 && v.width > 0 && v.height > 0
  && v.x + v.width <= 1 && v.y + v.height <= 1;
const validSizes = (v: unknown): v is DockSizes => isRecord(v)
  && isFiniteNumber(v.leftFraction) && v.leftFraction >= 0 && v.leftFraction <= 0.45
  && isFiniteNumber(v.rightFraction) && v.rightFraction >= 0 && v.rightFraction <= 0.45
  && isFiniteNumber(v.bottomFraction) && v.bottomFraction >= 0 && v.bottomFraction <= 0.5;
const validDock = (v: unknown): v is Dock => typeof v === "string" && DOCKS.some((d) => d === v);

export function createWorkspace(studioId: Studio): Layout {
  return {
    schemaVersion: 1, studioId,
    docks: { left: [], right: [], bottom: [] },
    collapsed: [], activeTabs: {},
    sizes: { leftFraction: 0.22, rightFraction: 0.24, bottomFraction: 0.27 },
    floating: [],
  };
}

/** Strictly validate untrusted presets before making them active. */
export function parsePreset(raw: string, known: ReadonlySet<string>): Layout | null {
  let object: unknown;
  try { object = JSON.parse(raw) as unknown; } catch { return null; }
  if (!isRecord(object) || object.schemaVersion !== 1
    || !STUDIOS.some((s) => s === object.studioId)) return null;
  const dockData = object.docks;
  if (!isRecord(dockData) || !DOCKS.every((d) => panels(dockData[d], known))) return null;
  if (!panels(object.collapsed, known) || !validSizes(object.sizes)
    || !isRecord(object.activeTabs) || !Array.isArray(object.floating)
    || object.floating.length > 12) return null;
  const floating = object.floating as unknown[];
  const floatingValid = floating.every((p) =>
    isRecord(p) && typeof p.panelId === "string" && known.has(p.panelId) && validRect(p.rect));
  if (!floatingValid) return null;
  const ids = [
    ...(dockData.left as string[]), ...(dockData.right as string[]),
    ...(dockData.bottom as string[]),
    ...floating.map((p) => (p as { panelId: string }).panelId),
  ];
  if (ids.length !== new Set(ids).size
    || object.collapsed.length !== new Set(object.collapsed).size
    || !object.collapsed.every((id) => ids.includes(id))) return null;
  const tabs: Partial<Record<Dock, string>> = {};
  for (const [dock, id] of Object.entries(object.activeTabs)) {
    if (!validDock(dock) || typeof id !== "string"
      || !(dockData[dock] as string[]).includes(id) || object.collapsed.includes(id)) return null;
    tabs[dock] = id;
  }
  return {
    schemaVersion: 1, studioId: object.studioId as Studio,
    docks: { left: [...(dockData.left as string[])], right: [...(dockData.right as string[])], bottom: [...(dockData.bottom as string[])] },
    collapsed: [...object.collapsed], activeTabs: tabs,
    sizes: { ...object.sizes },
    floating: floating.map((p) => {
      const f = p as { panelId: string; rect: Rect };
      return { panelId: f.panelId, rect: { ...f.rect } };
    }),
  };
}

export function serializePreset(layout: Layout, known: ReadonlySet<string>): string {
  const content = JSON.stringify(layout);
  if (parsePreset(content, known) === null) throw new Error("Invalid workspace preset");
  return content;
}

/** Uses measured container dimensions, not device type or screen width. */
export function stageFits(l: Layout, g: Geometry): boolean {
  if (![g.width, g.height, g.minStageWidth, g.minStageHeight]
    .every((n) => isFiniteNumber(n) && n > 0)) return false;
  const open = (d: Dock): boolean => l.docks[d].some((id) => !l.collapsed.includes(id));
  const width = g.width * (1 - (open("left") ? l.sizes.leftFraction : 0)
    - (open("right") ? l.sizes.rightFraction : 0));
  const height = g.height * (1 - (open("bottom") ? l.sizes.bottomFraction : 0));
  return width >= g.minStageWidth && height >= g.minStageHeight;
}
function withoutPanel(l: Layout, id: string): Layout {
  const docks: Layout["docks"] = { left: [], right: [], bottom: [] };
  const tabs = { ...l.activeTabs };
  for (const d of DOCKS) {
    docks[d] = l.docks[d].filter((p) => p !== id);
    if (tabs[d] === id) {
      const next = docks[d].find((p) => !l.collapsed.includes(p));
      if (next) tabs[d] = next;
      else delete tabs[d];
    }
  }
  return { ...l, docks, activeTabs: tabs, floating: l.floating.filter((f) => f.panelId !== id) };
}
export function dockPanel(l: Layout, id: string, dock: Dock, position: number,
  known: ReadonlySet<string>, geometry?: Geometry): Result {
  if (!known.has(id)) return failure(l, "unknown-panel");
  if (!validDock(dock) || !Number.isInteger(position) || position < 0) return failure(l, "invalid-position");
  const next = withoutPanel(l, id);
  if (position > next.docks[dock].length || next.docks[dock].length >= 40) return failure(l, "invalid-position");
  next.docks[dock].splice(position, 0, id);
  next.collapsed = next.collapsed.filter((p) => p !== id);
  next.activeTabs[dock] = id;
  return geometry && !stageFits(next, geometry)
    ? failure(l, "no-stage-space") : { ok: true, layout: next };
}
export function collapsePanel(l: Layout, id: string, collapsed: boolean): Result {
  if (!hasPanel(l, id)) return failure(l, "missing-panel");
  const next: Layout = {
    ...l, collapsed: collapsed ? [...new Set([...l.collapsed, id])] : l.collapsed.filter((p) => p !== id),
    activeTabs: { ...l.activeTabs },
  };
  for (const d of DOCKS) {
    if (collapsed && next.activeTabs[d] === id) {
      const replacement = next.docks[d].find((p) => !next.collapsed.includes(p));
      if (replacement) next.activeTabs[d] = replacement;
      else delete next.activeTabs[d];
    } else if (!collapsed && next.docks[d].includes(id)) next.activeTabs[d] = id;
  }
  return { ok: true, layout: next };
}
export function floatPanel(l: Layout, id: string, rect: Rect, known: ReadonlySet<string>): Result {
  if (!known.has(id)) return failure(l, "unknown-panel");
  if (!validRect(rect)) return failure(l, "invalid-geometry");
  const next = withoutPanel(l, id);
  if (next.floating.length >= 12) return failure(l, "invalid-position");
  next.floating.push({ panelId: id, rect: { ...rect } });
  next.collapsed = next.collapsed.filter((p) => p !== id);
  return { ok: true, layout: next };
}
export function resizeDock(l: Layout, dock: Dock, fraction: number, geometry: Geometry): Result {
  if (!validDock(dock) || !isFiniteNumber(fraction) || fraction < 0
    || fraction > (dock === "bottom" ? 0.5 : 0.45)) return failure(l, "invalid-geometry");
  const key = dock === "left" ? "leftFraction" : dock === "right" ? "rightFraction" : "bottomFraction";
  const next: Layout = { ...l, sizes: { ...l.sizes, [key]: fraction } };
  return stageFits(next, geometry) ? { ok: true, layout: next } : failure(l, "no-stage-space");
}
