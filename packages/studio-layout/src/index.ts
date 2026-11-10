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

/** Accessible equivalents of dock drag/drop; host maps keyboard, pointer, and
 * screen-reader actions to the same atomic state transition.
 * The engine/document and GPU lifecycle remain owned by the host.
 */
export type DockAction =
  | "move-left" | "move-right" | "move-bottom"
  | "move-before" | "move-after"
  | "collapse" | "expand" | "activate";

export function applyDockAction(
  layout: Layout, id: string, action: DockAction,
  known: ReadonlySet<string>, geometry?: Geometry,
): Result {
  if (!known.has(id)) return failure(layout, "unknown-panel");
  if (action === "collapse" || action === "expand") {
    return collapsePanel(layout, id, action === "collapse");
  }
  const source = DOCKS.find(d => layout.docks[d].includes(id));
  if (action === "activate") {
    if (!source) return failure(layout, "missing-panel");
    // This also expands collapsed panels and restores their tab selection.
    const expanded = collapsePanel(layout, id, false);
    return expanded.ok && (!geometry || stageFits(expanded.layout, geometry))
      ? expanded : failure(layout, "no-stage-space");
  }
  if (action.startsWith("move-") && ["move-left", "move-right", "move-bottom"].includes(action)) {
    const target = action.slice(5) as Dock;
    const destinationLength = layout.docks[target].filter(p => p !== id).length;
    return dockPanel(layout, id, target, destinationLength, known, geometry);
  }
  if (!source) return failure(layout, "missing-panel");
  const index = layout.docks[source].indexOf(id);
  if (action === "move-before") {
    if (index === 0) return { ok: true, layout };
    return dockPanel(layout, id, source, index - 1, known, geometry);
  }
  if (action === "move-after") {
    if (index === layout.docks[source].length - 1) return { ok: true, layout };
    return dockPanel(layout, id, source, index + 1, known, geometry);
  }
  return failure(layout, "invalid-position");
}

/** Host/window-space coordinates; never guess screen size from device names. */
export type Point = { x: number; y: number };
export type DockDropPreview = {
  dock: Dock;
  position: number;
  /** Host/window-space preview for a non-destructive drag indicator. */
  rect: Rect;
};
/** Touch, pointer and stylus share the same hit test; keyboard uses applyDockAction. */
export type DockDropQuery = {
  layout: Layout;
  known: ReadonlySet<string>;
  panelId: string;
  point: Point;
  /** Measured editor host including its offset from the physical window. */
  host: Rect;
  /** Occluding or separating folding regions converted to window coordinates. */
  blockedRegions?: readonly Rect[];
  /** Dock snapping distance in logical pixels/points. */
  snapDistance?: number;
  minimumStageWidth: number;
  minimumStageHeight: number;
};
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Resolve a magnetic rail preview without committing any layout mutation.
 * Hinge/keyboard/safe-area geometry comes from a real host adapter; this
 * function neither queries native APIs nor invents a fold posture.
 */
export function resolveDockDropPreview({
  layout, known, panelId, point, host, blockedRegions = [], snapDistance = 36,
  minimumStageWidth, minimumStageHeight,
}: DockDropQuery): DockDropPreview | null {
  if (!known.has(panelId) ||
      ![point.x, point.y, host.x, host.y, host.width, host.height,
        snapDistance, minimumStageWidth, minimumStageHeight].every(isFiniteNumber) ||
      host.width <= 0 || host.height <= 0 ||
      minimumStageWidth <= 0 || minimumStageHeight <= 0 ||
      snapDistance < 8 || snapDistance > 160 ||
      point.x < host.x || point.x > host.x + host.width ||
      point.y < host.y || point.y > host.y + host.height) return null;
  if (blockedRegions.some(blocked => (
    ![blocked.x, blocked.y, blocked.width, blocked.height].every(isFiniteNumber) ||
    blocked.width < 0 || blocked.height < 0
  ))) return null;
  if (blockedRegions.some(r =>
    point.x >= r.x && point.x <= r.x + r.width &&
    point.y >= r.y && point.y <= r.y + r.height
  )) return null;

  const nearest = ([
    { dock: "left" as Dock, distance: point.x - host.x },
    { dock: "right" as Dock, distance: host.x + host.width - point.x },
    { dock: "bottom" as Dock, distance: host.y + host.height - point.y },
  ]).filter(candidate => candidate.distance <= snapDistance)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!nearest) return null;
  const { dock } = nearest;
  const position = layout.docks[dock].filter(id => id !== panelId).length;
  const geometry: Geometry = {
    width: host.width, height: host.height,
    minStageWidth: minimumStageWidth, minStageHeight: minimumStageHeight,
  };
  const result = dockPanel(layout, panelId, dock, position, known, geometry);
  if (!result.ok) return null;
  const { leftFraction, rightFraction, bottomFraction } = layout.sizes;
  const rect: Rect = dock === "left"
    ? { x: host.x, y: host.y, width: host.width * leftFraction, height: host.height }
    : dock === "right"
      ? { x: host.x + host.width * (1 - rightFraction), y: host.y,
          width: host.width * rightFraction, height: host.height }
      : { x: host.x, y: host.y + host.height * (1 - bottomFraction),
          width: host.width, height: host.height * bottomFraction };
  if (blockedRegions.some(region => overlaps(rect, region))) return null;
  return { dock, position, rect };
}
