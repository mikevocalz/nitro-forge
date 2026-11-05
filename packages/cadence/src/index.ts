import {
  DocumentHandle,
  base64ToBytes,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — mirrors docs/ENGINE_OPS.md § cadence. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  setTempo: "setTempo",
  setTimeSig: "setTimeSig",
  transport: "transport",
  addTrack: "addTrack",
  removeTrack: "removeTrack",
  renameTrack: "renameTrack",
  setTrackGain: "setTrackGain",
  setTrackPan: "setTrackPan",
  setMuted: "setMuted",
  setSolo: "setSolo",
  addClip: "addClip",
  removeClip: "removeClip",
  moveClip: "moveClip",
  resizeClip: "resizeClip",
  addNote: "addNote",
  removeNote: "removeNote",
  moveNote: "moveNote",
  resizeNote: "resizeNote",
  setVelocity: "setVelocity",
  project: "project",
  render: "render",
} as const;

export type TrackKind = "midi" | "audio";

export interface ProjectInfo {
  tempo_bpm: number;
  time_sig: [number, number];
  length_ticks: number;
  track_count: number;
}

export class CadenceDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost, tempoBpm = 120): Promise<CadenceDocument> {
    const doc = await DocumentHandle.open(host, "cadence");
    await doc.apply(OPS.newDoc, { tempo_bpm: tempoBpm });
    return new CadenceDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<CadenceDocument> {
    const doc = await DocumentHandle.open(host, "cadence");
    await doc.restore(bytes);
    return new CadenceDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }
  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  setTempo(bpm: number) {
    return this.call(OPS.setTempo, { bpm });
  }
  setTimeSig(n: number, d: number) {
    return this.call(OPS.setTimeSig, { n, d });
  }
  transportTo(toTicks: number) {
    return this.call(OPS.transport, { to_ticks: toTicks });
  }
  addTrack(kind: TrackKind = "midi", name?: string) {
    return this.call<{ track_id: number }>(OPS.addTrack, { kind, name });
  }
  removeTrack(id: number) {
    return this.call(OPS.removeTrack, { id });
  }
  renameTrack(id: number, name: string) {
    return this.call(OPS.renameTrack, { id, name });
  }
  setTrackGain(id: number, volume: number) {
    return this.call(OPS.setTrackGain, { id, volume });
  }
  setTrackPan(id: number, pan: number) {
    return this.call(OPS.setTrackPan, { id, pan });
  }
  setMuted(id: number, muted: boolean) {
    return this.call(OPS.setMuted, { id, muted });
  }
  setSolo(id: number, solo: boolean) {
    return this.call(OPS.setSolo, { id, solo });
  }
  addClip(track: number, startTicks: number, lengthTicks: number) {
    return this.call<{ clip_id: number }>(OPS.addClip, {
      track,
      start_ticks: startTicks,
      length_ticks: lengthTicks,
    });
  }
  removeClip(id: number) {
    return this.call(OPS.removeClip, { id });
  }
  moveClip(id: number, startTicks: number) {
    return this.call(OPS.moveClip, { id, start_ticks: startTicks });
  }
  resizeClip(id: number, lengthTicks: number) {
    return this.call(OPS.resizeClip, { id, length_ticks: lengthTicks });
  }
  addNote(
    clip: number,
    pitch: number,
    startTicks: number,
    lengthTicks: number,
    velocity = 100,
  ) {
    return this.call<{ index: number }>(OPS.addNote, {
      clip,
      pitch,
      velocity,
      start_ticks: startTicks,
      length_ticks: lengthTicks,
    });
  }
  removeNote(clip: number, index: number) {
    return this.call(OPS.removeNote, { clip, index });
  }
  /**
   * Move one note to a clip-relative start and, when `pitch` is given, to a
   * new pitch in the same command, so a piano-roll drag is one undo step.
   * The note keeps its index. Rejects with `out_of_bounds` past the clip end.
   */
  moveNote(clip: number, index: number, startTicks: number, pitch?: number) {
    return this.call(OPS.moveNote, {
      clip,
      index,
      start_ticks: startTicks,
      ...(pitch === undefined ? {} : { pitch }),
    });
  }
  /** Set one note's length in ticks (> 0, ending at or before the clip end). */
  resizeNote(clip: number, index: number, lengthTicks: number) {
    return this.call(OPS.resizeNote, { clip, index, length_ticks: lengthTicks });
  }
  /** Set one note's MIDI velocity, 0..127. */
  setVelocity(clip: number, index: number, velocity: number) {
    return this.call(OPS.setVelocity, { clip, index, velocity });
  }
  project() {
    return this.call<ProjectInfo>(OPS.project);
  }
  /** Offline-render the range to stereo f32 PCM. */
  async render(fromTicks: number, toTicks: number, sampleRate = 44100) {
    const r = await this.call<{ samples_b64: string; frames: number }>(
      OPS.render,
      { from_ticks: fromTicks, to_ticks: toTicks, sample_rate: sampleRate },
    );
    return {
      samples: new Float32Array(base64ToBytes(r.data.samples_b64).buffer),
      frames: r.data.frames,
    };
  }
  describe<T = unknown>() {
    return this.call<T>(OPS.describe);
  }

  save() {
    return this.doc.snapshot();
  }
  undo() {
    return this.doc.undo();
  }
  redo() {
    return this.doc.redo();
  }
  close() {
    return this.doc.close();
  }
}
