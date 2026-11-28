/**
 * Automation lane math for `AutomationLane` and `AutomationModePicker`.
 * No React, platform or audio engine
 * imports.
 *
 * Matches the Cadence engine contract: each track has a `gain` lane (linear
 * amplitude, 0..1) and a `pan` lane (-1 left .. 1 right). Points are sorted
 * by absolute timeline ticks with at most one point per tick. In read mode
 * the render is linear between points and held before the first and after
 * the last point.
 *
 * Geometry is in lane-content points: x grows with time from tick 0 and
 * never mirrors for right-to-left layouts; y grows downward, with the top of
 * the lane at the parameter's maximum.
 *
 * @see {@linkcode automationSegments} for the drawn line.
 */
import { FADER_RANGES, dbToGain, formatDb, gainToDb, stepGain } from "./level.ts";
import { PAN_CENTRE_DETENT, formatPan, quantizePan, stepPan } from "./pan.ts";

/** The automatable parameter of a track lane, drawn by `AutomationLane`. */
export interface CustomAutomationParam {readonly id:string;readonly label:string;readonly minimum:number;readonly maximum:number;readonly defaultValue:number;readonly step:number;readonly unit?:string;readonly scale?:'linear'|'log'}
export type AutomationParam = "gain" | "pan" | CustomAutomationParam;
export function validateAutomationParam(param:AutomationParam):void{
 if(typeof param==='string'){if(param!=='gain'&&param!=='pan')throw new RangeError('Unknown automation parameter');return;}
 if(!param.id.trim()||param.id.length>512||!param.label.trim()||param.label.length>1024||![param.minimum,param.maximum,param.defaultValue,param.step].every(Number.isFinite)||param.minimum>=param.maximum||Math.abs(param.minimum)>1e12||Math.abs(param.maximum)>1e12||param.defaultValue<param.minimum||param.defaultValue>param.maximum||param.step<=0||param.step>param.maximum-param.minimum||!Number.isFinite((param.maximum-param.minimum)/param.step)||(param.maximum-param.minimum)/param.step>Number.MAX_SAFE_INTEGER||param.unit!==undefined&&param.unit.length>64||param.scale!==undefined&&!['linear','log'].includes(param.scale)||param.scale==='log'&&(param.minimum<=0||!Number.isFinite(param.maximum/param.minimum)))throw new RangeError('Invalid automation parameter');
}

/**
 * Engine automation mode. `off` ignores the points (the fader or pan control
 * sets the value); `read` follows them. Write/touch/latch/trim are enabled
 * only when the host supplies the corresponding live-transport capability.
 * @see {@linkcode AUTOMATION_MODES}
 */
export type AutomationMode = "off" | "read" | "write" | "touch" | "latch" | "trim";

/** Every UI mode, in picker order; the picker gates host capabilities. */
export const AUTOMATION_MODES: readonly AutomationMode[] = ["off", "read", "write", "touch", "latch", "trim"];

/** One automation breakpoint: absolute timeline ticks and a parameter value. */
export interface AutomationPoint {
  /** Absolute timeline ticks (integer, >= 0). */
  readonly ticks: number;
  /** Linear gain 0..1 for `gain`, -1..1 for `pan`. */
  readonly value: number;
}

/** Ticks per quarter note used by the engine. */
export const AUTOMATION_PPQ = 960;
/** Default time grid for adding, dragging and stepping points: a sixteenth. */
export const DEFAULT_SNAP_TICKS = 240;
/**
 * Vertical inset, points, above the maximum and below the minimum value, so a
 * point at either extreme keeps its whole 44 pt target inside the lane.
 */
export const AUTOMATION_LANE_PAD = 22;

/** Size and scale of a lane's content. */
export interface AutomationGeometry {
  readonly param: AutomationParam;
  /** Lane height, points. Must exceed `2 * AUTOMATION_LANE_PAD`. */
  readonly height: number;
  readonly pixelsPerTick: number;
  /** Timeline length the lane covers, ticks. */
  readonly lengthTicks: number;
}

/** Inclusive value range of a parameter. */
export function paramRange(param: AutomationParam): { readonly min: number; readonly max: number } {
  validateAutomationParam(param);if(typeof param==='object')return {min:param.minimum,max:param.maximum};
  return param === "gain" ? { min: 0, max: 1 } : { min: -1, max: 1 };
}

/** Value the engine uses when a lane has no points: unity gain or centre pan. */
export function neutralValue(param: AutomationParam): number {
  validateAutomationParam(param);if(typeof param==='object')return param.defaultValue;
  return param === "gain" ? 1 : 0;
}

/** @throws {RangeError} On a nonpositive scale, height or length. */
export function assertGeometry(g: AutomationGeometry): void {
  validateAutomationParam(g.param);
  if(!Number.isFinite(g.lengthTicks*g.pixelsPerTick)||g.lengthTicks*g.pixelsPerTick>Number.MAX_SAFE_INTEGER)throw new RangeError("Automation geometry cannot be represented");
  if (!Number.isFinite(g.pixelsPerTick) || g.pixelsPerTick <= 0) throw new RangeError("pixelsPerTick must be positive");
  if (!Number.isFinite(g.height) || g.height <= AUTOMATION_LANE_PAD * 2) {
    throw new RangeError(`Automation lane height must exceed ${AUTOMATION_LANE_PAD * 2}`);
  }
  if (!Number.isInteger(g.lengthTicks) || g.lengthTicks <= 0) throw new RangeError("lengthTicks must be a positive integer");
}

/** Gains quieter than this, in dB, quantize to silence. */
export const AUTOMATION_GAIN_FLOOR_DB = -90;

function quantizeGain(gain: number): number {
  const g = Math.min(1, Math.max(0, gain));
  if (g === 0) return 0;
  const db = Math.round(gainToDb(g) * 10) / 10;
  return db < AUTOMATION_GAIN_FLOOR_DB ? 0 : dbToGain(db);
}

/**
 * Clamp and quantize a value: gain to the 0.1 dB grid a fader uses (quieter
 * than {@linkcode AUTOMATION_GAIN_FLOOR_DB} becomes silence), pan to 0.01.
 */
export function clampAutomationValue(param: AutomationParam, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Automation value must be finite");
  if(typeof param==='object'){validateAutomationParam(param);return Math.min(param.maximum,Math.max(param.minimum,param.minimum+Math.round((value-param.minimum)/param.step)*param.step));}
  return param === "pan" ? quantizePan(value) : quantizeGain(value);
}

/**
 * Vertical position in [0, 1], 0 at the bottom. Gain uses a cubic fader
 * taper (position = cube root of linear gain: -6 dB sits at 0.79, -20 dB
 * at 0.46, silence at 0), so the working range gets most of the height;
 * pan is linear with right at the top.
 */
export function valueToPosition(param: AutomationParam, value: number): number {
  if(typeof param==='object'){validateAutomationParam(param);const v=Math.min(param.maximum,Math.max(param.minimum,value));return param.scale==='log'?Math.log(v/param.minimum)/Math.log(param.maximum/param.minimum):(v-param.minimum)/(param.maximum-param.minimum);}
  if (param === "pan") return (Math.min(1, Math.max(-1, value)) + 1) / 2;
  return Math.cbrt(Math.min(1, Math.max(0, value)));
}

/** Inverse of {@linkcode valueToPosition}, quantized like {@linkcode clampAutomationValue}. */
export function positionToValue(param: AutomationParam, position: number): number {
  const p = Math.min(1, Math.max(0, position));
  if(typeof param==='object'){validateAutomationParam(param);return clampAutomationValue(param,param.scale==='log'?param.minimum*(param.maximum/param.minimum)**p:param.minimum+p*(param.maximum-param.minimum));}
  if (param === "gain") return quantizeGain(p * p * p);
  const pan = quantizePan(p * 2 - 1);
  return Math.abs(pan) <= PAN_CENTRE_DETENT / 2 ? 0 : pan;
}

/** Content y, points from the lane top, for a value. */
export function valueToY(value: number, g: Pick<AutomationGeometry, "param" | "height">): number {
  const travel = g.height - AUTOMATION_LANE_PAD * 2;
  return AUTOMATION_LANE_PAD + (1 - valueToPosition(g.param, value)) * travel;
}

/** Value at content y. Positions above or below the padded travel clamp. */
export function yToValue(y: number, g: Pick<AutomationGeometry, "param" | "height">): number {
  const travel = g.height - AUTOMATION_LANE_PAD * 2;
  return positionToValue(g.param, 1 - (y - AUTOMATION_LANE_PAD) / travel);
}

/** Content x for absolute ticks. */
export function ticksToX(ticks: number, pixelsPerTick: number): number {
  return ticks * pixelsPerTick;
}

/**
 * Ticks at a viewport x. `scrollX` is the horizontal scroll of the view the
 * lane follows; the result is snapped to `snapTicks` and clamped into
 * `[0, lengthTicks]`.
 */
export function xToTicks(x: number, g: Pick<AutomationGeometry, "pixelsPerTick" | "lengthTicks">, snapTicks = DEFAULT_SNAP_TICKS, scrollX = 0): number {
  return snapTicksTo((x + scrollX) / g.pixelsPerTick, snapTicks, g.lengthTicks);
}

/** Round to the nearest multiple of `snapTicks` and clamp into `[0, lengthTicks]`. */
export function snapTicksTo(ticks: number, snapTicks: number, lengthTicks: number): number {
  if (!Number.isFinite(ticks)) throw new RangeError("ticks must be finite");
  if (!Number.isInteger(snapTicks) || snapTicks < 1) throw new RangeError("snapTicks must be a positive integer");
  return Math.min(lengthTicks, Math.max(0, Math.round(ticks / snapTicks) * snapTicks));
}

/**
 * Rendered value at `ticks` in read mode: linear between points, held before
 * the first and after the last. `undefined` when the lane has no points.
 */
export function valueAt(points: readonly AutomationPoint[], ticks: number): number | undefined {
  if (points.length === 0) return undefined;
  if (ticks <= points[0]!.ticks) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (ticks >= last.ticks) return last.value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (ticks <= b.ticks) {
      const a = points[i - 1]!;
      return a.value + (b.value - a.value) * ((ticks - a.ticks) / (b.ticks - a.ticks));
    }
  }
  return last.value;
}

/**
 * A straight line piece for an absolutely positioned view rotated about its
 * centre (the same shape `Sparkline` draws): place it at `centerX`/`centerY`,
 * `length` wide, rotated by `angleDeg`.
 */
export interface AutomationSegment {
  readonly centerX: number;
  readonly centerY: number;
  readonly length: number;
  readonly angleDeg: number;
}

function segment(x1: number, y1: number, x2: number, y2: number): AutomationSegment {
  const dx = x2 - x1, dy = y2 - y1;
  return { centerX: (x1 + x2) / 2, centerY: (y1 + y2) / 2, length: Math.hypot(dx, dy), angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * The line a lane draws: a held piece from x 0 to the first point, the
 * ramp between each pair of points, and a held piece from the last point
 * to the lane end (`lengthTicks`). Pan ramps are one straight piece; gain
 * ramps are several, because a linear-gain ramp is curved on the lane's dB
 * scale. Zero-length pieces are dropped. Empty input draws nothing.
 */
export function automationSegments(points: readonly AutomationPoint[], g: AutomationGeometry): AutomationSegment[] {
  assertGeometry(g);
  if (points.length === 0) return [];
  const xy = points.map(p => [ticksToX(p.ticks, g.pixelsPerTick), valueToY(p.value, g)] as const);
  const end = ticksToX(g.lengthTicks, g.pixelsPerTick);
  const out: AutomationSegment[] = [];
  const [fx, fy] = xy[0]!;
  if (fx > 0) out.push(segment(0, fy, fx, fy));
  for (let i = 1; i < xy.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const [ax, ay] = xy[i - 1]!, [bx, by] = xy[i]!;
    // The engine ramps linear gain, which is a curve on the dB scale: split
    // gain ramps into short pieces that sample the real render.
    const pieces = (g.param === "gain"||typeof g.param==='object'&&g.param.scale==='log') && a.value !== b.value ? Math.min(32, Math.max(2, Math.ceil((bx - ax) / 6))) : 1;
    let px = ax, py = ay;
    for (let k = 1; k <= pieces; k++) {
      const t = k / pieces;
      const nx = k === pieces ? bx : ax + (bx - ax) * t;
      const ny = k === pieces ? by : valueToY(a.value + (b.value - a.value) * t, g);
      out.push(segment(px, py, nx, ny));
      px = nx; py = ny;
    }
  }
  const [lx, ly] = xy[xy.length - 1]!;
  if (end > lx) out.push(segment(lx, ly, end, ly));
  return out.filter(s => s.length > 0);
}

/**
 * Index of the point whose centre is nearest to content `(x, y)` within
 * `radius` points, or `undefined`. Used so a tap on a point's target never
 * adds a second point.
 */
export function hitTestPoint(points: readonly AutomationPoint[], x: number, y: number, g: AutomationGeometry, radius = 22): number | undefined {
  let best: number | undefined;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.max(Math.abs(ticksToX(p.ticks, g.pixelsPerTick) - x), Math.abs(valueToY(p.value, g) - y));
    if (d <= radius && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/**
 * Open tick interval a point may occupy: strictly after its previous
 * neighbour and strictly before its next one, inside `[0, lengthTicks]`.
 */
export function pointBounds(points: readonly AutomationPoint[], index: number, lengthTicks: number): { readonly min: number; readonly max: number } {
  const prev = points[index - 1];
  const next = points[index + 1];
  return { min: prev ? prev.ticks + 1 : 0, max: next ? next.ticks - 1 : lengthTicks };
}

/**
 * Clamp a proposed tick for point `index`: snap to `snapTicks`, then keep it
 * strictly between the neighbours. When the nearest grid line is taken, the
 * result is the closest free tick inside the bounds, which can sit off-grid.
 */
export function clampPointTicks(points: readonly AutomationPoint[], index: number, ticks: number, snapTicks: number, lengthTicks: number): number {
  const { min, max } = pointBounds(points, index, lengthTicks);
  const snapped = snapTicksTo(ticks, snapTicks, lengthTicks);
  if (snapped >= min && snapped <= max) return snapped;
  // Nearest grid line inside the bounds, else the bound itself.
  const lowGrid = Math.ceil(min / snapTicks) * snapTicks;
  const highGrid = Math.floor(max / snapTicks) * snapTicks;
  if (snapped < min) return lowGrid <= max ? lowGrid : min;
  return highGrid >= min ? highGrid : max;
}

/** Result of a point drag or key step. */
export interface AutomationPointEdit {
  readonly ticks: number;
  readonly value: number;
}

/**
 * Where point `index` lands after a drag of `dx`, `dy` points from its
 * committed position. Relative, so grabbing never jumps. Time snaps and
 * stays between the neighbours; the value follows the lane's scale.
 */
export function dragPoint(points: readonly AutomationPoint[], index: number, dx: number, dy: number, g: AutomationGeometry, snapTicks = DEFAULT_SNAP_TICKS): AutomationPointEdit {
  assertGeometry(g);
  const p = points[index];
  if (!p) throw new RangeError("No automation point at index " + index);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError("Invalid automation drag");
  const ticks = clampPointTicks(points, index, p.ticks + dx / g.pixelsPerTick, snapTicks, g.lengthTicks);
  const value = dy === 0 ? p.value : yToValue(valueToY(p.value, g) + dy, g);
  return { ticks, value };
}

/** Options for {@linkcode automationKeyEdit}. */
export interface AutomationKeyOptions {
  readonly param: AutomationParam;
  readonly lengthTicks: number;
  /** Arrow Left/Right step. @default DEFAULT_SNAP_TICKS */
  readonly snapTicks?: number;
  /** Ticks per bar for Shift+Left/Right. @default 3840 (4/4 at 960 ppq) */
  readonly barTicks?: number;
}

/** What a key does to a focused point. */
export type AutomationKeyEdit =
  | { readonly kind: "move"; readonly ticks: number; readonly value: number }
  | { readonly kind: "remove" };

/**
 * Key handling for a focused point. Up/Down change the value (1 dB or 5 %
 * pan; PageUp/PageDown 6 dB or 25 %), Left/Right move by `snapTicks`
 * (Shift: one bar), Delete/Backspace remove. Returns `undefined` when the
 * key does nothing, including a move blocked by a neighbour.
 */
export function automationKeyEdit(points: readonly AutomationPoint[], index: number, key: string, shift: boolean, o: AutomationKeyOptions): AutomationKeyEdit | undefined {
  const p = points[index];
  if (!p) return undefined;
  if (key === "Delete" || key === "Backspace") return { kind: "remove" };
  const snap = o.snapTicks ?? DEFAULT_SNAP_TICKS;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const step = shift ? (o.barTicks ?? AUTOMATION_PPQ * 4) : snap;
    const raw = p.ticks + (key === "ArrowRight" ? step : -step);
    const { min, max } = pointBounds(points, index, o.lengthTicks);
    const ticks = Math.min(max, Math.max(min, raw));
    return ticks === p.ticks ? undefined : { kind: "move", ticks, value: p.value };
  }
  const dir = key === "ArrowUp" || key === "PageUp" ? 1 : key === "ArrowDown" || key === "PageDown" ? -1 : 0;
  if (dir === 0) return undefined;
  const big = key === "PageUp" || key === "PageDown";
  const value = stepAutomationValue(o.param, p.value, dir, big);
  return value === p.value ? undefined : { kind: "move", ticks: p.ticks, value };
}

/** One value step: 1 dB / 5 % pan, or 6 dB / 25 % pan when `big`. */
export function stepAutomationValue(param: AutomationParam, value: number, direction: -1 | 1, big = false): number {
  if(typeof param==='object')return clampAutomationValue(param,value+param.step*direction*(big?10:1));
  if (param === "pan") return stepPan(Math.min(1, Math.max(-1, value)), direction, big ? 0.25 : 0.05);
  return stepGain(Math.min(1, Math.max(0, value)), direction, big ? 6 : 1, FADER_RANGES.UNITY);
}

/** Display text for a value: gain as `"-6.0 dB"` / `"-inf dB"`, pan as `"L 30"`, `"C"`, `"R 30"`. */
export function formatAutomationValue(param: AutomationParam, value: number): string {
  if(typeof param==='object')return Number(clampAutomationValue(param,value).toPrecision(8))+(param.unit?' '+param.unit:'');
  if (param === "pan") return formatPan(Math.min(1, Math.max(-1, value)));
  const text = formatDb(Math.min(1, Math.max(0, value)));
  return text === "-∞ dB" ? "-inf dB" : text;
}

/**
 * Musical position, e.g. `"Bar 2 beat 1"` or `"Bar 1 beat 2.5"` for an
 * off-beat tick. Bars and beats count from 1.
 */
export function formatPosition(ticks: number, ppq = AUTOMATION_PPQ, beatsPerBar = 4): string {
  if (!Number.isFinite(ticks) || ticks < 0) throw new RangeError("ticks must be finite and nonnegative");
  const barTicks = ppq * beatsPerBar;
  const bar = Math.floor(ticks / barTicks) + 1;
  const beat = (ticks - (bar - 1) * barTicks) / ppq + 1;
  const text = Number.isInteger(beat) ? String(beat) : String(Number(beat.toFixed(2)));
  return `Bar ${bar} beat ${text}`;
}

/** Accessible value text for a point, e.g. `"Bar 2 beat 1, -6.0 dB"`. */
export function describeAutomationPoint(point: AutomationPoint, param: AutomationParam, ppq = AUTOMATION_PPQ, beatsPerBar = 4): string {
  return formatPosition(point.ticks, ppq, beatsPerBar) + ", " + formatAutomationValue(param, point.value);
}

/** Whether a new point may go at `ticks` (the engine rejects a duplicate tick). */
export function canAddPointAt(points: readonly AutomationPoint[], ticks: number): boolean {
  return !points.some(p => p.ticks === ticks);
}
