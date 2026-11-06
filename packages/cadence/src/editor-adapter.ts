import type { CadenceDocument } from "./index";

/**
 * Maps NYC-Tron's mixer and MIDI editor callbacks onto Cadence engine ops.
 *
 * Consumers: `MixingConsole`/`ChannelStrip`/`PanControl`/`SoloMuteButtons`,
 * `TempoAndMetronome`, `MIDIPianoRoll`, `MIDIVelocityLane` and
 * `StepSequencer` from `@nyc-tron/ui` (NYC-Tron-UI #41, released in the
 * v0.1.0-alpha.3 pin in tooling/nyc-tron.json). Cadence's runtime does not
 * import them; tests/nyc-tron-props.typecheck.ts checks every binding here
 * against the released props.
 *
 * Every callback is one engine command, so one UI gesture is one undo step.
 * Values are validated before the command; a rejected promise means the
 * engine kept its previous state.
 *
 * Not mapped, on purpose:
 * - the metronome switch: use CadenceMixerAdapter.metronome() from
 *   ./mixer-cluster for the new engine click; the host owns audio output.
 * - `WaveformLane.visibleRange`: a view window, not document state.
 */

type Doc = Pick<
  CadenceDocument,
  | "setTrackGain" | "setTrackPan" | "setMuted" | "setSolo"
  | "setTempo" | "setTimeSig"
  | "addNote" | "removeNote" | "moveNote" | "resizeNote" | "setVelocity"
>;
type Result = Awaited<ReturnType<CadenceDocument["setTrackGain"]>>;

/** Track id as NYC-Tron's `MixerChannel.id` carries it. */
export type ChannelId = string | number;

/** `MixerChannel` (NYC-Tron `forge/audio/mixer`). */
export interface CadenceMixerChannel {
  readonly id: number;
  readonly name: string;
  /** Engine `volume`, linear 0..1. */
  readonly gain: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

/** `MidiNote` (NYC-Tron `forge/midi/note-grid`); index in the array is the engine index. */
export interface CadenceMidiNote {
  readonly pitch: number;
  readonly velocity: number;
  readonly startTicks: number;
  readonly lengthTicks: number;
}

/** `MixingConsole` commit props. */
export interface CadenceMixerBindings {
  readonly onGainCommit: (id: ChannelId, gain: number) => Promise<Result>;
  readonly onPanCommit: (id: ChannelId, pan: number) => Promise<Result>;
  readonly onMutedCommit: (id: ChannelId, muted: boolean) => Promise<Result>;
  readonly onSoloCommit: (id: ChannelId, solo: boolean) => Promise<Result>;
}

/** `TempoAndMetronome` commit props plus the engine's tempo range. */
export interface CadenceTempoBindings {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onTempoCommit: (bpm: number) => Promise<Result>;
  readonly onTimeSignatureCommit: (timeSignature: readonly [number, number]) => Promise<Result>;
}

/** `MIDIPianoRoll`, `MIDIVelocityLane` and `StepSequencer` commit props for one clip. */
export interface CadenceClipBindings {
  readonly onNoteMove: (index: number, startTicks: number, pitch: number) => Promise<Result>;
  readonly onNoteResize: (index: number, lengthTicks: number) => Promise<Result>;
  readonly onNoteAdd: (startTicks: number, lengthTicks: number, pitch: number) => Promise<Result>;
  readonly onNoteRemove: (index: number) => Promise<Result>;
  readonly onVelocityCommit: (index: number, velocity: number) => Promise<Result>;
  readonly onStepAdd: (pitch: number, startTicks: number, lengthTicks: number, velocity: number) => Promise<Result>;
  readonly onStepRemove: (index: number) => Promise<Result>;
  readonly onStepVelocity: (index: number, velocity: number) => Promise<Result>;
}

/** Options for {@linkcode createCadenceClipBindings}. */
export interface CadenceClipBindingOptions {
  /** Velocity of a note added by tapping the piano roll. @default 100 */
  readonly newNoteVelocity?: number;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;

function trackId(id: ChannelId): number {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`Invalid Cadence track id ${String(id)}`);
  return n;
}
function inRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be ${min}..${max}`);
  return value;
}
function integer(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer ${min}..${max}`);
  return value;
}
const ticks = (name: string, value: number) => integer(name, value, 0, Number.MAX_SAFE_INTEGER);
// Validation errors become rejections, the same channel as engine errors.
const attempt = <T>(run: () => Promise<T>): Promise<T> => {
  try { return run(); } catch (error) { return Promise.reject(error); }
};

/** Mixer strip commits → `setTrackGain` / `setTrackPan` / `setMuted` / `setSolo`. */
export function createCadenceMixerBindings(document: Doc): CadenceMixerBindings {
  return {
    onGainCommit: (id, gain) => attempt(() => document.setTrackGain(trackId(id), inRange("gain", gain, 0, 1))),
    onPanCommit: (id, pan) => attempt(() => document.setTrackPan(trackId(id), inRange("pan", pan, -1, 1))),
    onMutedCommit: (id, muted) => attempt(() => document.setMuted(trackId(id), Boolean(muted))),
    onSoloCommit: (id, solo) => attempt(() => document.setSolo(trackId(id), Boolean(solo))),
  };
}

/** Tempo commits → `setTempo` / `setTimeSig`. */
export function createCadenceTempoBindings(document: Doc): CadenceTempoBindings {
  return {
    min: MIN_BPM,
    max: MAX_BPM,
    step: 1,
    onTempoCommit: bpm => attempt(() => document.setTempo(inRange("bpm", bpm, MIN_BPM, MAX_BPM))),
    onTimeSignatureCommit: ([n, d]) => attempt(() => {
      integer("numerator", n, 1, 0xffff_ffff);
      if (!Number.isInteger(d) || d < 1 || d > 128 || (d & (d - 1)) !== 0) {
        throw new RangeError("denominator must be a power of two up to 128");
      }
      return document.setTimeSig(n, d);
    }),
  };
}

/** Note editor commits for one MIDI clip → `moveNote` / `resizeNote` / `addNote` / `removeNote` / `setVelocity`. */
export function createCadenceClipBindings(
  document: Doc,
  clipId: number,
  options: CadenceClipBindingOptions = {},
): CadenceClipBindings {
  if (!Number.isSafeInteger(clipId) || clipId < 1) throw new RangeError("Invalid Cadence clip id");
  const newVelocity = integer("newNoteVelocity", options.newNoteVelocity ?? 100, 0, 127);
  const index = (i: number) => ticks("index", i);
  const add = (pitch: number, start: number, length: number, velocity: number) => attempt(() =>
    document.addNote(clipId, integer("pitch", pitch, 0, 127), ticks("startTicks", start),
      integer("lengthTicks", length, 1, Number.MAX_SAFE_INTEGER), integer("velocity", velocity, 0, 127)));
  const velocity = (i: number, v: number) => attempt(() => document.setVelocity(clipId, index(i), integer("velocity", v, 0, 127)));
  const remove = (i: number) => attempt(() => document.removeNote(clipId, index(i)));
  return {
    onNoteMove: (i, start, pitch) => attempt(() =>
      document.moveNote(clipId, index(i), ticks("startTicks", start), integer("pitch", pitch, 0, 127))),
    onNoteResize: (i, length) => attempt(() =>
      document.resizeNote(clipId, index(i), integer("lengthTicks", length, 1, Number.MAX_SAFE_INTEGER))),
    onNoteAdd: (start, length, pitch) => add(pitch, start, length, newVelocity),
    onNoteRemove: remove,
    onVelocityCommit: velocity,
    onStepAdd: add,
    onStepRemove: remove,
    onStepVelocity: velocity,
  };
}

/** Shape of Cadence `describe()` the editors read. */
export interface CadenceDescribe {
  readonly tempo_bpm: number;
  readonly time_sig: readonly [number, number];
  readonly ppq: number;
  readonly tracks: readonly {
    readonly id: number;
    readonly name: string;
    readonly kind: "midi" | "audio";
    readonly volume: number;
    readonly pan: number;
    readonly muted: boolean;
    readonly solo: boolean;
    readonly clips: readonly {
      readonly id: number;
      readonly start_ticks: number;
      readonly length_ticks: number;
      readonly notes?: readonly { pitch: number; velocity: number; start_ticks: number; length_ticks: number }[];
    }[];
  }[];
}

/** Mixer channels in track order. */
export function toMixerChannels(project: CadenceDescribe): CadenceMixerChannel[] {
  return project.tracks.map(t => ({ id: t.id, name: t.name, gain: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }));
}

/** One clip's notes in engine order, or undefined when the clip does not exist. */
export function toMidiNotes(project: CadenceDescribe, clipId: number): { notes: CadenceMidiNote[]; clipTicks: number } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find(c => c.id === clipId);
    if (clip) {
      return {
        clipTicks: clip.length_ticks,
        notes: (clip.notes ?? []).map(n => ({
          pitch: n.pitch, velocity: n.velocity, startTicks: n.start_ticks, lengthTicks: n.length_ticks,
        })),
      };
    }
  }
  return undefined;
}
