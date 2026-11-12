import type { BeatDetectionResult, CadenceDocument, CadenceMarker, MarkerPatch } from '../../../packages/cadence/src/index';

/*
 * Engine side of NYC-Tron v1.0.0 E-35 BeatDetectionMarkerLane (F3 option B).
 * No @nyc-tron import: the shapes mirror the v1.0.0 props structurally so this
 * module and its tests run without the UI package.
 *
 * Cadence stores markers in ticks so they follow tempo; the lane works in
 * frames and seconds. Conversions use the project's ppq and its single tempo:
 * seconds = ticks / (ppq * bpm / 60) (ENGINE_OPS.md, Cadence time base).
 */

/** v1.0.0 `FrameRate`. */
export interface FrameRateShape { readonly numerator: number; readonly denominator: number }
/** v1.0.0 `TimelineMarker`. */
export interface TimelineMarkerShape { readonly id: string; readonly frame: number; readonly durationFrames?: number; readonly name: string; readonly note?: string }
/** v1.0.0 `MarkerUpdate`. */
export interface MarkerUpdateShape { readonly frame: number; readonly seconds: number; readonly durationFrames?: number; readonly durationSeconds?: number; readonly name?: string; readonly note?: string }
/** The project fields the conversions need. */
export interface CadenceTimeBase { readonly ppq: number; readonly tempo_bpm: number }

/** detectBeats accepts sensitivity in 0..1; 0.5 reproduces the detector's output from before the option existed. */
export const DEFAULT_BEAT_SENSITIVITY = 0.5;
const MAX_BATCH = 8192;

function ticksPerSecond(time: CadenceTimeBase) {
  if (!Number.isSafeInteger(time.ppq) || time.ppq <= 0 || !Number.isFinite(time.tempo_bpm) || time.tempo_bpm <= 0)
    throw new RangeError('The project tempo or resolution is not usable.');
  return time.ppq * time.tempo_bpm / 60;
}
export function cadenceSecondsToTicks(seconds: number, time: CadenceTimeBase) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Marker time must be zero or later.');
  return Math.round(seconds * ticksPerSecond(time));
}
export function cadenceTicksToSeconds(ticks: number, time: CadenceTimeBase) { return ticks / ticksPerSecond(time); }
function secondsToFrame(seconds: number, rate: FrameRateShape) { return Math.round(seconds * rate.numerator / rate.denominator); }

/** Stored markers as lane markers; ids become strings, ticks become frames at `rate`. */
export function cadenceLaneMarkers(markers: readonly CadenceMarker[], time: CadenceTimeBase, rate: FrameRateShape): TimelineMarkerShape[] {
  return markers.map(marker => ({
    id: String(marker.id), name: marker.name,
    frame: secondsToFrame(cadenceTicksToSeconds(marker.ticks, time), rate),
    ...(marker.length_ticks > 0 ? { durationFrames: Math.max(1, secondsToFrame(cadenceTicksToSeconds(marker.length_ticks, time), rate)) } : {}),
    ...(marker.note === undefined ? {} : { note: marker.note }),
  }));
}

function markerId(id: string) {
  if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new RangeError('Not a Cadence marker id.');
  return Number(id);
}

/** `onSensitivityCommit`: the value is host state passed to the next detection, never stored in the document. */
export function cadenceBeatSensitivity(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Beat detection sensitivity must be between 0 and 1.');
  return value;
}

/**
 * Onsets to add as markers: each onset in ticks from the range start, skipping
 * any tick that already has a marker, so a second run (for example at a
 * higher sensitivity) adds only the beats the first run missed.
 */
export function cadenceBeatMarkerInputs(result: Pick<BeatDetectionResult, 'onsets_seconds'>, fromTicks: number, existing: readonly Pick<CadenceMarker, 'ticks'>[], time: CadenceTimeBase) {
  const taken = new Set(existing.map(marker => marker.ticks)), out: { ticks: number; name: string }[] = [];
  for (const seconds of result.onsets_seconds) {
    const ticks = fromTicks + cadenceSecondsToTicks(seconds, time);
    if (taken.has(ticks)) continue;
    taken.add(ticks);
    out.push({ ticks, name: `Beat ${out.length + 1}` });
  }
  if (existing.length + out.length > MAX_BATCH) throw new RangeError('A project holds at most 8192 markers.');
  return out;
}

/**
 * `onDetect`: one read-only detectBeats over the range at `sensitivity`, then
 * the new onsets as one addMarkers call, which is one undo step. Nothing is
 * written when no new onset is found.
 */
export async function detectCadenceBeats(document: Pick<CadenceDocument, 'detectBeats' | 'addMarkers'>, range: { readonly fromTicks: number; readonly toTicks: number },
  sensitivity: number, existing: readonly Pick<CadenceMarker, 'ticks'>[], time: CadenceTimeBase, signal?: AbortSignal) {
  cadenceBeatSensitivity(sensitivity);
  if (!Number.isSafeInteger(range.fromTicks) || !Number.isSafeInteger(range.toTicks) || range.fromTicks < 0 || range.toTicks <= range.fromTicks)
    throw new RangeError('Add a clip before detecting beats.');
  const result = (await document.detectBeats({ fromTicks: range.fromTicks, toTicks: range.toTicks, sampleRate: 48000, includeMetronome: false }, { sensitivity })).data;
  if (signal?.aborted) return { result, added: 0 };
  const inputs = cadenceBeatMarkerInputs(result, range.fromTicks, existing, time);
  if (inputs.length) await document.addMarkers(inputs);
  return { result, added: inputs.length };
}

/** `lane.onAdd`: a point marker at the playhead. */
export function addCadenceLaneMarker(document: Pick<CadenceDocument, 'addMarker'>, at: { readonly seconds: number }, time: CadenceTimeBase) {
  return document.addMarker({ ticks: cadenceSecondsToTicks(at.seconds, time) });
}

/** `lane.onUpdate`: the lane always sends the position; length, name and note only when changed. */
export function updateCadenceLaneMarker(document: Pick<CadenceDocument, 'updateMarker'>, id: string, update: MarkerUpdateShape, time: CadenceTimeBase) {
  const patch: MarkerPatch = { ticks: cadenceSecondsToTicks(update.seconds, time) };
  if (update.durationSeconds !== undefined) patch.lengthTicks = cadenceSecondsToTicks(update.durationSeconds, time);
  if (update.name !== undefined) patch.name = update.name;
  if (update.note !== undefined) patch.note = update.note === '' ? null : update.note;
  return document.updateMarker(markerId(id), patch);
}

/** `lane.onRemove`. */
export function removeCadenceLaneMarker(document: Pick<CadenceDocument, 'removeMarker'>, id: string) {
  return document.removeMarker(markerId(id));
}
