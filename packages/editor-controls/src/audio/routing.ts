/**
 * Routing model for {@linkcode BusAndRoutingMatrix}. Pure; no React or
 * engine imports.
 *
 * Mirrors the Cadence routing contract: a source track has one `output`
 * (a bus id, or `null` for the master) and any number of post-fader sends.
 * Buses feed the master only, so they never appear as sources here.
 */

/** Engine id of a track or bus. Also the React key. */
export type RouteId = string | number;

/** One post-fader send from a source to a bus, as the engine reports it. */
export interface RoutingSend {
  /** Bus that receives the send. */
  readonly bus: RouteId;
  /** Linear send level, 0 (silent) .. 1 (unity). */
  readonly level: number;
}

/** A track that can be routed, as passed to {@linkcode BusAndRoutingMatrix}. */
export interface RoutingSource {
  readonly id: RouteId;
  readonly name: string;
  /** Bus the track's main output feeds, or `null` for the master. */
  readonly output: RouteId | null;
  /** Committed sends, at most one per bus. */
  readonly sends: readonly RoutingSend[];
}

/** A bus that sources can output to or send to. */
export interface RoutingBus {
  readonly id: RouteId;
  readonly name: string;
}

/**
 * Container width, in points, at which {@linkcode routingLayout} switches
 * from one card per source to the grid.
 */
export const ROUTING_GRID_MIN_WIDTH = 600;

/** Level a new send starts at: -6 dB, a common starting point for an effect return. */
export const DEFAULT_SEND_LEVEL = 0.5;

/** Size of one arrow-key or screen-reader step, as a fraction of full level. */
export const SEND_STEP = 0.05;

/** Size of one PageUp/PageDown step. */
export const SEND_PAGE_STEP = 0.2;

/** Which layout {@linkcode BusAndRoutingMatrix} draws at a measured container width. */
export type RoutingLayout = "grid" | "cards";

/** Grid column widths, in points. Send columns repeat once per bus. */
export const ROUTING_COLUMNS = { name: 132, output: 236, send: 208 } as const;

/** Narrowest container, in points, that fits the grid for `busCount` buses without sideways scrolling. */
export function routingGridWidth(busCount: number): number {
  return ROUTING_COLUMNS.name + ROUTING_COLUMNS.output + busCount * ROUTING_COLUMNS.send;
}

/**
 * Layout for a measured container width. The grid needs at least
 * {@linkcode ROUTING_GRID_MIN_WIDTH} and room for every send column, so a
 * wide bus list falls back to cards instead of scrolling sideways.
 * Unmeasured (0) gets cards.
 */
export function routingLayout(widthPt: number, busCount: number): RoutingLayout {
  return widthPt >= Math.max(ROUTING_GRID_MIN_WIDTH, routingGridWidth(busCount)) ? "grid" : "cards";
}

/** Clamp a send level to 0..1 and round to whole percent, so commits stay stable. */
export function clampSendLevel(level: number): number {
  if (!Number.isFinite(level)) throw new RangeError("Send level must be finite");
  return Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
}

/** Send level as whole percent text, e.g. `"50%"`. */
export function formatSendLevel(level: number): string {
  return Math.round(clampSendLevel(level) * 100) + "%";
}

/** Level after `direction` steps of `step` from `level`, clamped. */
export function stepSendLevel(level: number, direction: number, step: number = SEND_STEP): number {
  return clampSendLevel(level + direction * step);
}

/**
 * Level for a horizontal drag of `deltaPt` points that started at
 * `startLevel` on a track `trackPt` points long. Positive delta raises.
 */
export function dragToSendLevel(startLevel: number, deltaPt: number, trackPt: number): number {
  if (!(trackPt > 0)) throw new RangeError("Track length must be positive");
  return clampSendLevel(startLevel + deltaPt / trackPt);
}

/** Committed send level from `source` to `bus`, or `undefined` when there is no send. */
export function sendLevel(source: Pick<RoutingSource, "sends">, bus: RouteId): number | undefined {
  return source.sends.find(s => s.bus === bus)?.level;
}

/** Where a source's main output goes, resolved against the bus list. */
export type ResolvedOutput =
  | { readonly kind: "master" }
  | { readonly kind: "bus"; readonly bus: RoutingBus }
  /** The output names a bus that is not in the list, e.g. one removed elsewhere. */
  | { readonly kind: "missing"; readonly id: RouteId };

/** Resolve a source's `output` against `buses`. */
export function resolveOutput(output: RouteId | null, buses: readonly RoutingBus[]): ResolvedOutput {
  if (output === null) return { kind: "master" };
  const bus = buses.find(b => b.id === output);
  return bus ? { kind: "bus", bus } : { kind: "missing", id: output };
}

/** Spoken or visible name of a resolved output. */
export function outputName(resolved: ResolvedOutput): string {
  if (resolved.kind === "master") return "Master";
  if (resolved.kind === "bus") return resolved.bus.name;
  return "Missing bus";
}

/**
 * Output option after moving `direction` places from `current` through
 * `[null, ...bus ids]`, wrapping at the ends like a radio group.
 */
export function cycleOutput(current: RouteId | null, buses: readonly RoutingBus[], direction: 1 | -1): RouteId | null {
  const options: (RouteId | null)[] = [null, ...buses.map(b => b.id)];
  const index = options.indexOf(current);
  const from = index < 0 ? 0 : index;
  return options[(from + direction + options.length) % options.length];
}

/** Accessible name of a send control, e.g. `"Vocal send to Reverb"`. */
export function sendLabel(sourceName: string, busName: string): string {
  return `${sourceName} send to ${busName}`;
}
