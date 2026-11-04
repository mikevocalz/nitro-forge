/** Forge 2046 instrument contracts and deterministic interaction math.
 * UI components live in the studio-workspace native/web adapters; the Rust
 * document session remains authoritative for every committed edit.
 * No library images or proprietary editor code are embedded in this package.
 */

export type ForgeStudio = 'prism' | 'cadence' | 'splice' | 'quill' | 'tally' | 'pitch' | 'folio' | 'board';
export type InputModality = 'pointer' | 'touch' | 'pen' | 'keyboard' | 'accessibility' | 'controller' | 'gaze';
export type InstrumentFamily = 'spatial' | 'color' | 'temporal' | 'audio' | 'ink' | 'type' | 'data' | 'layers' | 'export';
export type EditBoundary = 'engine-transaction' | 'read-only-signal' | 'workspace-local';

export type InstrumentBlueprint = Readonly<{
  id: string;
  label: string;
  family: InstrumentFamily;
  studios: readonly ForgeStudio[] | 'all';
  input: readonly InputModality[];
  boundary: EditBoundary;
  intent: string;
  /**
   * Must be true only after real native/web source, connected engine data,
   * accessibility and physical-device evidence have been reviewed.
   */
  releaseVerified: boolean;
}>;

/** A design catalog and type contract, NOT a false claim that these views ship. */
export const forgeInstrumentBlueprints: readonly InstrumentBlueprint[] = [
  { id: 'forge.precision-scrubber', label: 'Precision Scrubber', family: 'spatial', studios: 'all', input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility', 'controller'], boundary: 'engine-transaction', intent: 'Fine, normal and coarse unit-aware value edits with detents and one commit', releaseVerified: false },
  { id: 'forge.command-orbit', label: 'Command Orbit', family: 'spatial', studios: 'all', input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility', 'controller', 'gaze'], boundary: 'workspace-local', intent: 'Contextual commands with fully visible and accessible alternatives', releaseVerified: false },
  { id: 'forge.layer-constellation', label: 'Layer Constellation', family: 'layers', studios: ['prism', 'splice', 'pitch', 'board'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Nested object tree, selection, reordering and reversible drop preview', releaseVerified: false },
  { id: 'forge.revision-atlas', label: 'Revision Atlas', family: 'layers', studios: 'all', input: ['pointer', 'touch', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Engine-backed revisions and safe comparisons only when capability exists', releaseVerified: false },
  { id: 'forge.chroma-space', label: 'Chroma Space', family: 'color', studios: ['prism', 'splice', 'pitch', 'board'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Color/profile-aware multi-plane picking, gradients and alpha', releaseVerified: false },
  { id: 'forge.color-wheels', label: 'Color Wheels', family: 'color', studios: ['prism', 'splice'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Tonal-band wheel and channel precision with real pipeline values', releaseVerified: false },
  { id: 'forge.curve-lab', label: 'Curve Lab', family: 'color', studios: ['prism', 'splice', 'pitch'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Tangent-aware curves, channel keys and exact sampled data', releaseVerified: false },
  { id: 'forge.scope-array', label: 'Scope Array', family: 'color', studios: ['prism', 'splice'], input: ['pointer', 'touch', 'keyboard', 'accessibility'], boundary: 'read-only-signal', intent: 'True histograms, vectorscopes and parade signals from source frames', releaseVerified: false },
  { id: 'forge.ink-deck', label: 'Infinite Ink Deck', family: 'ink', studios: ['prism', 'board', 'folio', 'quill'], input: ['touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Pressure, tilt, texture and responsive brush dynamics when hardware supports them', releaseVerified: false },
  { id: 'forge.temporal-canvas', label: 'Temporal Canvas', family: 'temporal', studios: ['splice', 'cadence', 'pitch'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Zoomable frame/beat timeline, multi-track selection and exact transport', releaseVerified: false },
  { id: 'forge.motion-curve', label: 'Motion Curve', family: 'temporal', studios: ['splice', 'pitch', 'cadence'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Bezier keyframe and automation editing with stable engine timebase', releaseVerified: false },
  { id: 'forge.spectral-wave', label: 'Spectral Wave', family: 'audio', studios: ['splice', 'cadence'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'read-only-signal', intent: 'Waveform/RMS/spectrum with real playback and sample metadata', releaseVerified: false },
  { id: 'forge.harmonic-mixer', label: 'Harmonic Mixer', family: 'audio', studios: ['cadence', 'splice'], input: ['pointer', 'touch', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Faders, buses, sends, metering and automation from active sessions', releaseVerified: false },
  { id: 'forge.piano-roll', label: 'Piano Roll', family: 'audio', studios: ['cadence'], input: ['pointer', 'touch', 'pen', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Beat-quantized note lanes and velocity articulation', releaseVerified: false },
  { id: 'forge.type-laboratory', label: 'Type Laboratory', family: 'type', studios: ['quill', 'pitch', 'folio'], input: ['pointer', 'touch', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Variable font axes, paragraph rhythm and exact text structure', releaseVerified: false },
  { id: 'forge.formula-lens', label: 'Formula Lens', family: 'data', studios: ['tally'], input: ['pointer', 'touch', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Workbook dependencies and provenance with precise range edits', releaseVerified: false },
  { id: 'forge.export-chamber', label: 'Export Chamber', family: 'export', studios: 'all', input: ['pointer', 'touch', 'keyboard', 'accessibility'], boundary: 'engine-transaction', intent: 'Real format-specific preflight, restrictions, metadata and validation', releaseVerified: false },
  { id: 'forge.spatial-portal', label: 'Spatial Portal', family: 'spatial', studios: ['board', 'prism', 'pitch'], input: ['controller', 'gaze', 'pointer', 'accessibility'], boundary: 'workspace-local', intent: 'Occlusion-aware scene surface and spatial focus semantics', releaseVerified: false },
] as const;

export function instrumentsForStudio(studio: ForgeStudio): readonly InstrumentBlueprint[] {
  return forgeInstrumentBlueprints.filter(instrument =>
    instrument.studios === 'all' || instrument.studios.includes(studio));
}

export type ScrubMode = 'fine' | 'normal' | 'coarse';
export type PrecisionScrub = Readonly<{
  min: number;
  max: number;
  step: number;
  startValue: number;
  deltaPixels: number;
  pixelsPerStep?: number;
  mode?: ScrubMode;
  detents?: readonly number[];
}>;

const assertFinite = (value: number, name: string) => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clean = (value: number) => Number(value.toFixed(9));

/**
 * Pure deterministic model for a high-precision instrument. The view may
 * animate locally, but the caller commits a single Rust command on release.
 * Fine mode subdivides the nominal step into tenths; normal/coarse preserve it.
 * Returns an absolute value so rerenders cannot accumulate delta drift.
 */
export function scrubPrecision(input: PrecisionScrub): number {
  const { min, max, step, startValue, deltaPixels } = input;
  for (const [name, value] of Object.entries({ min, max, step, startValue, deltaPixels })) assertFinite(value, name);
  if (min >= max || step <= 0) throw new RangeError('invalid precision range or step');
  const px = input.pixelsPerStep ?? 8;
  assertFinite(px, 'pixelsPerStep');
  if (px <= 0) throw new RangeError('pixelsPerStep must be positive');
  if (deltaPixels === 0) return clean(clamp(startValue, min, max));
  const mode = input.mode ?? 'normal';
  const factor = mode === 'fine' ? 0.1 : mode === 'coarse' ? 10 : mode === 'normal' ? 1 : NaN;
  if (!Number.isFinite(factor)) throw new RangeError('invalid scrub mode');
  const quantum = step * (mode === 'fine' ? 0.1 : 1);
  const unbounded = startValue + deltaPixels / px * step * factor;
  const snapped = min + Math.round((unbounded - min) / quantum) * quantum;
  const detent = (input.detents ?? []).find(value => Number.isFinite(value)
    && value >= min && value <= max && Math.abs(value - unbounded) <= quantum * 0.5);
  return clean(clamp(detent ?? snapped, min, max));
}

/** Exact rational frame rate is supported. Drop-frame DISPLAY rules belong to
 * the timecode formatter; the engine's seek index is always an integer frame. */
export type FrameRate = Readonly<{ numerator: number; denominator: number }>;
export type ForgeTimebase =
  | Readonly<{ kind: 'frames'; rate: FrameRate }>
  | Readonly<{ kind: 'beats'; bpm: number; beatsPerBar: number }>;

function unitsPerSecond(timebase: ForgeTimebase): number {
  if (timebase.kind === 'frames') {
    const { numerator, denominator } = timebase.rate;
    assertFinite(numerator, 'frame rate numerator');
    assertFinite(denominator, 'frame rate denominator');
    if (numerator <= 0 || denominator <= 0) throw new RangeError('invalid frame rate');
    return numerator / denominator;
  }
  assertFinite(timebase.bpm, 'bpm');
  assertFinite(timebase.beatsPerBar, 'beatsPerBar');
  if (timebase.bpm <= 0 || !Number.isInteger(timebase.beatsPerBar) || timebase.beatsPerBar < 1)
    throw new RangeError('invalid tempo or meter');
  return timebase.bpm / 60;
}

export function nearestTimeUnit(seconds: number, timebase: ForgeTimebase): number {
  assertFinite(seconds, 'seconds');
  return Math.max(0, Math.round(seconds * unitsPerSecond(timebase)));
}

export function timeAtUnit(unit: number, timebase: ForgeTimebase): number {
  assertFinite(unit, 'unit');
  if (unit < 0 || !Number.isInteger(unit)) throw new RangeError('unit must be a nonnegative integer');
  return unit / unitsPerSecond(timebase);
}

export type RulerTick = Readonly<{ unit: number; seconds: number; major: boolean }>;
export type RulerQuery = Readonly<{
  timebase: ForgeTimebase;
  startSeconds: number;
  endSeconds: number;
  pixelsPerSecond: number;
  minMajorPixelSpacing?: number;
  maxTicks?: number;
}>;

function niceStep(needed: number): number {
  const exponent = Math.floor(Math.log10(Math.max(1, needed)));
  const base = 10 ** exponent;
  for (const factor of [1, 2, 5, 10]) if (base * factor >= needed) return base * factor;
  return base * 10;
}

/** Bounded, zoom-stable major/minor tick model for both NLE and DAW surfaces.
 * View renderers may virtualize/paint ticks via Skia3; tick data is not an
 * invented media waveform nor a second playback clock.
 */
export function temporalRulerTicks(query: RulerQuery): readonly RulerTick[] {
  const { startSeconds, endSeconds, pixelsPerSecond } = query;
  for (const [name, value] of Object.entries({ startSeconds, endSeconds, pixelsPerSecond })) assertFinite(value, name);
  if (startSeconds < 0 || endSeconds <= startSeconds || pixelsPerSecond <= 0) throw new RangeError('invalid ruler viewport');
  const ups = unitsPerSecond(query.timebase);
  const majorPx = query.minMajorPixelSpacing ?? 96;
  const cap = query.maxTicks ?? 512;
  if (!Number.isFinite(majorPx) || majorPx <= 0 || !Number.isInteger(cap) || cap < 2 || cap > 4096)
    throw new RangeError('invalid ruler limits');
  const majorStep = niceStep(majorPx * ups / pixelsPerSecond);
  const minorStep = majorStep >= 5 ? majorStep / 5 : majorStep;
  const first = Math.ceil(startSeconds * ups / minorStep) * minorStep;
  const last = Math.floor(endSeconds * ups);
  const ticks: RulerTick[] = [];
  for (let unit = first; unit <= last && ticks.length < cap; unit += minorStep) {
    const exactUnit = Math.round(unit);
    ticks.push({
      unit: exactUnit,
      seconds: timeAtUnit(exactUnit, query.timebase),
      major: exactUnit % majorStep === 0,
    });
  }
  return ticks;
}
