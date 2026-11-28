/**
 * Batch velocity edits for {@linkcode MIDIVelocityLane}: the line tool (drag
 * a straight line across the bars) and the keyboard ramp. Pure: no React,
 * platform or engine imports.
 *
 * Both return the batch the Cadence engine's `setVelocities` op takes:
 * sorted by note index, no duplicate index, only notes whose velocity
 * changes. An empty batch means "commit nothing".
 */
import { clampVelocity, type MidiNote } from "./note-grid.ts";

/** One entry of a batch velocity edit. */
export interface VelocityChange {
  /** Index of the note in the clip's `notes` array (its engine identity). */
  readonly index: number;
  /** New velocity, integer 0..127. */
  readonly velocity: number;
}

/**
 * How a {@linkcode MIDIVelocityLane} maps ticks and velocity to points. All
 * values in points except `pixelsPerTick`.
 */
export interface VelocityLaneGeometry {
  /** Horizontal scale, points per tick. Same as the piano roll. */
  readonly pixelsPerTick: number;
  /** Leading space before tick 0 (the roll's key column). */
  readonly inset: number;
  /** Horizontal scroll of the lane content. */
  readonly scrollX: number;
  /** Lane height; the top edge is velocity 127, the bottom edge 0. */
  readonly height: number;
}

/** A point in the lane, measured from its top-left corner. `x` is physical (left to right) in every locale. */
export interface LanePoint {
  readonly x: number;
  readonly y: number;
}

function assertGeometry(g: VelocityLaneGeometry): void {
  if (!Number.isFinite(g.pixelsPerTick) || g.pixelsPerTick <= 0) throw new RangeError("pixelsPerTick must be positive");
  if (!Number.isFinite(g.height) || g.height <= 0) throw new RangeError("height must be positive");
  if (!Number.isFinite(g.inset) || !Number.isFinite(g.scrollX)) throw new RangeError("inset and scrollX must be finite");
}

/** The velocity a point at height `y` in the lane stands for, clamped to 0..127. */
export function velocityAtY(y: number, height: number): number {
  if (!Number.isFinite(height) || height <= 0) throw new RangeError("height must be positive");
  if (!Number.isFinite(y)) throw new RangeError("y must be finite");
  return clampVelocity((1 - y / height) * 127);
}

/** Where a note's bar sits horizontally in the lane, points from the lane's left edge. */
export function noteLaneX(note: MidiNote, g: VelocityLaneGeometry): number {
  return g.inset + note.startTicks * g.pixelsPerTick - g.scrollX;
}

/**
 * The batch for a straight line drawn from `start` to `end` across the lane.
 *
 * A note is hit when its start x lies within the segment's x span, widened
 * by `reach` points on each side (so a tap can land on a bar's visible
 * width). Its new velocity is the line's height at that x, interpolated
 * linearly and clamped to the segment's ends. Drag direction does not matter
 * and nothing depends on layout direction: x is physical, so earlier notes
 * always read the left end of the line. A zero-width segment (a tap, or a
 * straight-down drag) sets every hit note to the height of `end`.
 *
 * @param reach Extra horizontal reach on both sides, points. @default 0
 * @returns Changes sorted by index, only notes whose velocity changes.
 */
export function velocityLineChanges(
  notes: readonly MidiNote[],
  geometry: VelocityLaneGeometry,
  start: LanePoint,
  end: LanePoint,
  reach = 0,
): VelocityChange[] {
  assertGeometry(geometry);
  for (const p of [start, end]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new RangeError("Line points must be finite");
  }
  if (!Number.isFinite(reach) || reach < 0) throw new RangeError("reach must be >= 0");
  const [left, right] = start.x <= end.x ? [start, end] : [end, start];
  const changes: VelocityChange[] = [];
  notes.forEach((note, index) => {
    const x = noteLaneX(note, geometry);
    if (x < left.x - reach || x > right.x + reach) return;
    const span = right.x - left.x;
    const t = span === 0 ? 1 : Math.min(1, Math.max(0, (x - left.x) / span));
    const velocity = velocityAtY(left.y + (right.y - left.y) * t, geometry.height);
    if (velocity !== note.velocity) changes.push({ index, velocity });
  });
  return changes;
}

/**
 * Note indices in time order: by start, then pitch, then index, so notes in
 * a chord keep a stable order.
 */
export function notesInTimeOrder(notes: readonly MidiNote[]): number[] {
  return notes.map((_, i) => i).sort((a, b) =>
    notes[a]!.startTicks - notes[b]!.startTicks || notes[a]!.pitch - notes[b]!.pitch || a - b);
}

/**
 * The batch for the keyboard ramp: starting at note `fromIndex` and taking
 * the next `count - 1` notes in {@linkcode notesInTimeOrder}, velocities run
 * in equal steps from the first note's current velocity to `endVelocity`.
 * When fewer notes follow, the ramp covers the ones there are.
 *
 * @throws {RangeError} When `fromIndex` is not a note, `count` is under 2, or
 *   `endVelocity` is not a number.
 * @returns Changes sorted by index, only notes whose velocity changes.
 */
export function rampVelocities(
  notes: readonly MidiNote[],
  fromIndex: number,
  count: number,
  endVelocity: number,
): VelocityChange[] {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= notes.length) throw new RangeError("fromIndex must be a note index");
  if (!Number.isInteger(count) || count < 2) throw new RangeError("count must be an integer >= 2");
  const order = notesInTimeOrder(notes);
  const span = order.slice(order.indexOf(fromIndex), order.indexOf(fromIndex) + count);
  const first = notes[fromIndex]!.velocity;
  const last = clampVelocity(endVelocity);
  const changes: VelocityChange[] = [];
  span.forEach((index, k) => {
    const velocity = span.length === 1 ? first : clampVelocity(first + ((last - first) * k) / (span.length - 1));
    if (velocity !== notes[index]!.velocity) changes.push({ index, velocity });
  });
  return changes.sort((a, b) => a.index - b.index);
}

/** How many notes a ramp from `fromIndex` can cover: that note plus every later one. */
export function rampRoom(notes: readonly MidiNote[], fromIndex: number): number {
  const order = notesInTimeOrder(notes);
  const at = order.indexOf(fromIndex);
  return at < 0 ? 0 : order.length - at;
}

/** Spoken summary of a batch, e.g. `"3 velocities changed"`. */
export function describeVelocityBatch(changes: readonly VelocityChange[]): string {
  return changes.length === 0 ? "No velocities changed"
    : changes.length === 1 ? "1 velocity changed" : `${changes.length} velocities changed`;
}
