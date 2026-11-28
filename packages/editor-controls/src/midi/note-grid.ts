/**
 * Note geometry for {@linkcode MIDIPianoRoll}, {@linkcode MIDIVelocityLane}
 * and {@linkcode StepSequencer}. Pure: no React, platform or engine imports.
 *
 * Times are clip-relative ticks and a note's identity is its index in the
 * `notes` array, the same addressing the Cadence engine uses for
 * `moveNote`/`resizeNote`/`setVelocity`/`removeNote`.
 */

/** One MIDI note as the engine reports it. */
export interface MidiNote {
  /** 0..127; 60 is middle C (C4). */
  readonly pitch: number;
  /** 0..127. */
  readonly velocity: number;
  /** Clip-relative start, ticks >= 0. */
  readonly startTicks: number;
  /** Ticks > 0; start + length never passes the clip end. */
  readonly lengthTicks: number;
  /**
   * MIDI channel, 0..15 (people read it as 1..16; see
   * {@linkcode channelLabel}). Left out, the engine plays the note on
   * channel 0.
   */
  readonly channel?: number;
}

/** The visible pitch window and time scale of a piano roll. */
export interface NoteGrid {
  /** Clip length in ticks. Notes cannot extend past it. */
  readonly clipTicks: number;
  /** Lowest pitch row shown (bottom). */
  readonly lowestPitch: number;
  /** Highest pitch row shown (top). */
  readonly highestPitch: number;
  /** Horizontal scale. */
  readonly pixelsPerTick: number;
  /** Height of one pitch row, points. */
  readonly rowHeight: number;
  /** Grid quantum for moves, resizes and new notes, ticks. */
  readonly snapTicks: number;
}

/** A note's box in grid coordinates, points from the grid's top-left. */
export interface NoteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

/** @throws {RangeError} On a grid the controls cannot draw. */
export function assertGrid(g: NoteGrid): void {
  if (!Number.isInteger(g.clipTicks) || g.clipTicks <= 0) throw new RangeError("clipTicks must be a positive integer");
  if (!Number.isInteger(g.lowestPitch) || !Number.isInteger(g.highestPitch) ||
      g.lowestPitch < 0 || g.highestPitch > 127 || g.lowestPitch > g.highestPitch) {
    throw new RangeError("Pitch window must satisfy 0 <= lowestPitch <= highestPitch <= 127");
  }
  if (!Number.isFinite(g.pixelsPerTick) || g.pixelsPerTick <= 0) throw new RangeError("pixelsPerTick must be positive");
  if (!Number.isFinite(g.rowHeight) || g.rowHeight <= 0) throw new RangeError("rowHeight must be positive");
  if (!Number.isInteger(g.snapTicks) || g.snapTicks <= 0) throw new RangeError("snapTicks must be a positive integer");
}

/** `"C4"` for 60, `"A♯3"` for 58. */
export function pitchName(pitch: number): string {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new RangeError("Pitch must be 0..127");
  return NAMES[pitch % 12] + String(Math.floor(pitch / 12) - 1);
}

/** True for the black keys. */
export function isSharp(pitch: number): boolean {
  return NAMES[((pitch % 12) + 12) % 12]!.length > 1;
}

/** Pitches top to bottom, the order the rows are drawn. */
export function visiblePitches(g: NoteGrid): number[] {
  assertGrid(g);
  const rows: number[] = [];
  for (let p = g.highestPitch; p >= g.lowestPitch; p--) rows.push(p);
  return rows;
}

/** Total drawn size of the grid. */
export function gridSize(g: NoteGrid): { width: number; height: number } {
  assertGrid(g);
  return { width: g.clipTicks * g.pixelsPerTick, height: (g.highestPitch - g.lowestPitch + 1) * g.rowHeight };
}

/** Box for a note, or undefined when its pitch is outside the window. */
export function noteRect(n: MidiNote, g: NoteGrid): NoteRect | undefined {
  if (n.pitch < g.lowestPitch || n.pitch > g.highestPitch) return undefined;
  return {
    x: n.startTicks * g.pixelsPerTick,
    y: (g.highestPitch - n.pitch) * g.rowHeight,
    width: n.lengthTicks * g.pixelsPerTick,
    height: g.rowHeight,
  };
}

const snap = (ticks: number, q: number) => Math.round(ticks / q) * q;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Start and pitch after dragging a note body by (dx, dy) points. Time snaps
 * to the grid and the note stays inside the clip; pitch moves one row per
 * `rowHeight` and stays inside the visible window. Down lowers the pitch.
 */
export function dragNote(n: MidiNote, dx: number, dy: number, g: NoteGrid): { startTicks: number; pitch: number } {
  assertGrid(g);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError("Invalid drag");
  const latest = g.clipTicks - n.lengthTicks;
  const startTicks = clamp(snap(n.startTicks + dx / g.pixelsPerTick, g.snapTicks), 0, Math.max(0, latest));
  const pitch = clamp(n.pitch - Math.round(dy / g.rowHeight), g.lowestPitch, g.highestPitch);
  return { startTicks, pitch };
}

/**
 * Length after dragging a note's end edge by `dx` points. The end snaps to
 * the grid; the length is at least one grid step (or what fits) and ends at
 * or before the clip end.
 */
export function dragNoteEnd(n: MidiNote, dx: number, g: NoteGrid): number {
  assertGrid(g);
  if (!Number.isFinite(dx)) throw new RangeError("Invalid drag");
  const room = g.clipTicks - n.startTicks;
  const minimum = Math.min(g.snapTicks, room);
  const end = snap(n.startTicks + n.lengthTicks + dx / g.pixelsPerTick, g.snapTicks);
  return clamp(end - n.startTicks, minimum, room);
}

/**
 * The grid cell under a point, for adding a note there: start floored to the
 * grid, a one-step length that fits the clip, and the row's pitch. Undefined
 * outside the grid.
 */
export function cellAt(x: number, y: number, g: NoteGrid): { startTicks: number; lengthTicks: number; pitch: number } | undefined {
  assertGrid(g);
  const { width, height } = gridSize(g);
  if (!(x >= 0 && x < width && y >= 0 && y < height)) return undefined;
  const startTicks = Math.floor(x / g.pixelsPerTick / g.snapTicks) * g.snapTicks;
  const lengthTicks = Math.min(g.snapTicks, g.clipTicks - startTicks);
  const pitch = g.highestPitch - Math.floor(y / g.rowHeight);
  return { startTicks, lengthTicks, pitch };
}

/** Result of a keyboard edit on a focused note. */
export type NoteKeyEdit =
  | { readonly kind: "move"; readonly startTicks: number; readonly pitch: number }
  | { readonly kind: "resize"; readonly lengthTicks: number }
  | { readonly kind: "remove" };

/**
 * Keyboard edit for a focused note: arrows move by one grid step or one
 * semitone, Shift+Left/Right shortens/lengthens by one step, Delete or
 * Backspace removes. Undefined for other keys and for edits that would not
 * change the note. Time keys are physical (Right is later) in every locale.
 */
export function noteKeyEdit(n: MidiNote, key: string, shift: boolean, g: NoteGrid): NoteKeyEdit | undefined {
  assertGrid(g);
  if (key === "Delete" || key === "Backspace") return { kind: "remove" };
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (shift && step !== 0) {
    const room = g.clipTicks - n.startTicks;
    const lengthTicks = clamp(n.lengthTicks + step * g.snapTicks, Math.min(g.snapTicks, room), room);
    return lengthTicks === n.lengthTicks ? undefined : { kind: "resize", lengthTicks };
  }
  const semis = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
  if (step === 0 && semis === 0) return undefined;
  const startTicks = clamp(n.startTicks + step * g.snapTicks, 0, Math.max(0, g.clipTicks - n.lengthTicks));
  const pitch = clamp(n.pitch + semis, 0, 127);
  if (startTicks === n.startTicks && pitch === n.pitch) return undefined;
  return { kind: "move", startTicks, pitch };
}

/**
 * Spoken description of a note, e.g. `"C4, beat 2, 1 beat long, velocity 100"`.
 * With `withChannel`, appends `", channel 3"` (see {@linkcode channelLabel}).
 */
export function describeNote(n: MidiNote, ppq: number, withChannel = false): string {
  const beat = n.startTicks / ppq + 1;
  const beats = n.lengthTicks / ppq;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  const base = `${pitchName(n.pitch)}, beat ${fmt(beat)}, ${fmt(beats)} ${beats === 1 ? "beat" : "beats"} long, velocity ${n.velocity}`;
  return withChannel ? `${base}, ${channelLabel(n.channel ?? 0).toLowerCase()}` : base;
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/** Highest MIDI channel, zero-based. */
export const MAX_MIDI_CHANNEL = 15;

/** True for an integer 0..15. */
export function isMidiChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 0 && channel <= MAX_MIDI_CHANNEL;
}

/** `"Channel 1"` for 0, `"Channel 16"` for 15: the one-based number people use. */
export function channelLabel(channel: number): string {
  if (!isMidiChannel(channel)) throw new RangeError("MIDI channel must be 0..15");
  return `Channel ${channel + 1}`;
}

/**
 * True when the notes play on more than one channel (a note without
 * `channel` counts as channel 0). A roll names channels only then.
 */
export function usesSeveralChannels(notes: readonly MidiNote[]): boolean {
  const first = notes[0]?.channel ?? 0;
  return notes.some(n => (n.channel ?? 0) !== first);
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

/** Clamp and round a velocity into 0..127. */
export function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) throw new RangeError("Velocity must be finite");
  return Math.round(clamp(v, 0, 127));
}

/** Bar height for a velocity in a lane `laneHeight` tall. */
export function velocityToHeight(velocity: number, laneHeight: number): number {
  return (clampVelocity(velocity) / 127) * laneHeight;
}

/** Velocity after dragging a bar by `dy` points (up raises). Relative. */
export function dragVelocity(start: number, dy: number, laneHeight: number): number {
  if (!Number.isFinite(dy) || !Number.isFinite(laneHeight) || laneHeight <= 0) {
    throw new RangeError("Invalid velocity drag");
  }
  return clampVelocity(start - (dy / laneHeight) * 127);
}

// ---------------------------------------------------------------------------
// Step sequencer
// ---------------------------------------------------------------------------

/** One instrument row of a {@linkcode StepSequencer}. */
export interface StepLane {
  readonly pitch: number;
  /** Row label, e.g. `"Kick"`. */
  readonly name: string;
}

/** State of one step cell. */
export type StepCell =
  | { readonly on: false }
  | { readonly on: true; readonly noteIndex: number; readonly accent: boolean };

/**
 * Cells for `lanes` × `steps`. A note fills a cell when its pitch is the
 * lane's and it starts exactly on the step. Notes off the step grid are left
 * out (the piano roll shows them). The first matching note wins.
 */
export function stepCells(
  notes: readonly MidiNote[],
  lanes: readonly StepLane[],
  steps: number,
  stepTicks: number,
  accentVelocity: number,
): StepCell[][] {
  if (!Number.isInteger(steps) || steps < 1 || steps > 128) throw new RangeError("steps must be 1..128");
  if (!Number.isInteger(stepTicks) || stepTicks <= 0) throw new RangeError("stepTicks must be a positive integer");
  const index = new Map<string, number>();
  notes.forEach((n, i) => {
    if (n.startTicks % stepTicks !== 0) return;
    const key = n.pitch + ":" + n.startTicks / stepTicks;
    if (!index.has(key)) index.set(key, i);
  });
  return lanes.map(lane => Array.from({ length: steps }, (_, s): StepCell => {
    const i = index.get(lane.pitch + ":" + s);
    if (i === undefined) return { on: false };
    return { on: true, noteIndex: i, accent: notes[i]!.velocity >= accentVelocity };
  }));
}

/** Reject malformed engine note rosters before allocating editor views. */
export function assertMidiNotes(notes:readonly MidiNote[],clipTicks:number):void{
 if(!Number.isSafeInteger(clipTicks)||clipTicks<1||notes.length>4096||notes.some(n=>!Number.isInteger(n.pitch)||n.pitch<0||n.pitch>127||!Number.isInteger(n.velocity)||n.velocity<0||n.velocity>127||!Number.isSafeInteger(n.startTicks)||n.startTicks<0||!Number.isSafeInteger(n.lengthTicks)||n.lengthTicks<1||n.startTicks+n.lengthTicks>clipTicks||n.channel!==undefined&&(!Number.isInteger(n.channel)||n.channel<0||n.channel>15)))throw new RangeError('Invalid MIDI note roster');
}

/** A denominator beat or measure boundary, expressed in clip-relative ticks. */
export interface MidiGridLine { readonly ticks: number; readonly bar: boolean; }
/**
 * Bounded notation grid. PPQ remains quarter-note ticks; a denominator beat may
 * occupy a fractional tick and is drawn without changing note/snap precision.
 */
export function midiGridLines(clipTicks:number,ppq:number,beatsPerBar=4,timeSignature?:readonly[number,number],limit=256):readonly MidiGridLine[]{
 if(!Number.isSafeInteger(clipTicks)||clipTicks<0||!Number.isSafeInteger(ppq)||ppq<1||
  (timeSignature===undefined&&(!Number.isSafeInteger(beatsPerBar)||beatsPerBar<1||beatsPerBar>64))||!Number.isSafeInteger(limit)||limit<1||limit>4096)
  throw new RangeError('Invalid MIDI measure grid');
 if(timeSignature!==undefined&&(!Array.isArray(timeSignature)||timeSignature.length!==2))throw new RangeError('Invalid MIDI time signature');
 const numerator=timeSignature?.[0]??beatsPerBar,denominator=timeSignature?.[1]??4;
 if(!Number.isSafeInteger(numerator)||numerator<1||numerator>64||![1,2,4,8,16,32,64].includes(denominator))
  throw new RangeError('Invalid MIDI time signature');
 const beatTicks=ppq*4/denominator,beatCount=Math.ceil(clipTicks/beatTicks);
 const stride=beatCount<=limit?1:numerator*Math.max(1,Math.ceil(beatCount/(limit*numerator)));
 const lines:MidiGridLine[]=[];
 for(let beat=stride;beat<beatCount;beat+=stride)lines.push({ticks:beat*beatTicks,bar:beat%numerator===0});
 return lines;
}
