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
  renderStems: "renderStems",
  setTrackOutput: "setTrackOutput",
  setSend: "setSend",
  removeSend: "removeSend",
  addInsert: "addInsert",
  removeInsert: "removeInsert",
  moveInsert: "moveInsert",
  setInsertBypass: "setInsertBypass",
  setInsertParams: "setInsertParams",
  applyInsertPreset: "applyInsertPreset",
  insertPresets: "insertPresets",
  eqResponse: "eqResponse",
  dynamicsCurve: "dynamicsCurve",
  setTrackGroup: "setTrackGroup",
  setGroupSolo: "setGroupSolo",
  setGroupMuted: "setGroupMuted",
  setSoloSafe: "setSoloSafe",
  addAutomationPoint: "addAutomationPoint",
  moveAutomationPoint: "moveAutomationPoint",
  removeAutomationPoint: "removeAutomationPoint",
  setAutomationMode: "setAutomationMode",
  setVelocities: "setVelocities",
  setNoteChannel: "setNoteChannel",
  setMetronome: "setMetronome",
  meter: "meter",
  loudness: "loudness",
  spectrogram: "spectrogram",
} as const;

/** `bus` tracks sum source tracks routed or sent to them and hold no clips. */
export type TrackKind = "midi" | "audio" | "bus";

/** Insert effect kinds the engine processes. */
export type InsertKind = "gain" | "eq" | "compressor";

/** Automatable track parameters. `gain` is linear 0..1, `pan` -1..1. */
export type AutomationParam = "gain" | "pan";

/** `read` makes the render follow the lane; `off` keeps the fader value. */
export type AutomationMode = "off" | "read";

/** EQ band shapes. Low and high pass bands ignore `gain_db`. */
export type EqBandType = "peak" | "low_shelf" | "high_shelf" | "low_pass" | "high_pass";

/** One EQ band as the engine stores it. */
export interface EqBand {
  type: EqBandType;
  freq_hz: number;
  gain_db: number;
  q: number;
  enabled: boolean;
}

/** Compressor params; ranges in docs/ENGINE_OPS.md. */
export interface CompressorParams {
  threshold_db: number;
  ratio: number;
  knee_db: number;
  attack_ms: number;
  release_ms: number;
  makeup_db: number;
}

/** Partial params accepted by `addInsert`/`setInsertParams`, per kind. */
export type InsertParams =
  | { gain_db?: number }
  | { bands?: Partial<EqBand>[] }
  | Partial<CompressorParams>;

/** Render range shared by `meter`, `loudness` and `spectrogram`. */
export interface AnalysisRange {
  fromTicks: number;
  toTicks: number;
  /** 8000..192000. @default 48000 */
  sampleRate?: number;
  /** Mix the metronome click in when it is enabled. @default false */
  includeMetronome?: boolean;
}

/** One `meter` entry: per-window linear peak and RMS. */
export interface MeterReading {
  peak: number[];
  rms: number[];
  max_peak: number;
  clipped: boolean;
}

export interface MeterResult {
  window_frames: number;
  window_seconds: number;
  tracks: (MeterReading & { id: number })[];
  master: MeterReading;
}

/** `null` where the signal is silent or too short to measure. */
export interface LoudnessResult {
  integrated_lufs: number | null;
  momentary_max_lufs: number | null;
  short_term_max_lufs: number | null;
  sample_peak_dbfs: number | null;
  momentary_lufs: (number | null)[];
  step_seconds: number;
}

export interface SpectrogramResult {
  bands_hz: number[];
  hop_seconds: number;
  /** One row per hop, one dB value per band, floored at -120. */
  frames: number[][];
}

export interface InsertPreset {
  id: string;
  label: string;
  kind: InsertKind;
  params: unknown;
}

export interface ProjectInfo {
  tempo_bpm: number;
  time_sig: [number, number];
  length_ticks: number;
  track_count: number;
}

function analysisPayload(r: AnalysisRange) {
  return {
    from_ticks: r.fromTicks,
    to_ticks: r.toTicks,
    sample_rate: r.sampleRate ?? 48000,
    include_metronome: r.includeMetronome ?? false,
  };
}

export class CadenceDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost, tempoBpm = 120): Promise<CadenceDocument> {
    const doc = await DocumentHandle.openInitialized(host, "cadence",
      (document) => document.apply(OPS.newDoc, { tempo_bpm: tempoBpm }));
    return new CadenceDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<CadenceDocument> {
    const doc = await DocumentHandle.openSnapshot(host, "cadence", bytes);
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
    channel = 0,
  ) {
    return this.call<{ index: number }>(OPS.addNote, {
      clip,
      pitch,
      velocity,
      start_ticks: startTicks,
      length_ticks: lengthTicks,
      channel,
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
  /** Route a source track to a bus, or to the master with `null`. */
  setTrackOutput(id: number, output: number | null) {
    return this.call(OPS.setTrackOutput, { id, output });
  }
  /** Add or update a post-fader send, level 0..1. */
  setSend(track: number, bus: number, level: number) {
    return this.call(OPS.setSend, { track, bus, level });
  }
  removeSend(track: number, bus: number) {
    return this.call(OPS.removeSend, { track, bus });
  }
  /** Insert an effect at `index` (default: end of the chain). */
  addInsert(track: number, kind: InsertKind, options: { index?: number; params?: InsertParams } = {}) {
    return this.call<{ insert_id: number; index: number }>(OPS.addInsert, { track, kind, ...options });
  }
  removeInsert(id: number) {
    return this.call(OPS.removeInsert, { id });
  }
  moveInsert(id: number, index: number) {
    return this.call(OPS.moveInsert, { id, index });
  }
  setInsertBypass(id: number, bypassed: boolean) {
    return this.call(OPS.setInsertBypass, { id, bypassed });
  }
  /** Merge params into an insert; any invalid field rejects the whole call. */
  setInsertParams(id: number, params: InsertParams) {
    return this.call(OPS.setInsertParams, { id, params });
  }
  applyInsertPreset(id: number, preset: string) {
    return this.call(OPS.applyInsertPreset, { id, preset });
  }
  insertPresets(kind: InsertKind) {
    return this.call<{ presets: InsertPreset[] }>(OPS.insertPresets, { kind });
  }
  /** Magnitude response of an EQ insert at log-spaced points, 20 Hz..20 kHz. */
  eqResponse(id: number, points = 128, sampleRate = 48000) {
    return this.call<{ points: { hz: number; db: number }[] }>(OPS.eqResponse, { id, points, sample_rate: sampleRate });
  }
  /** Static transfer curve of a compressor insert, -60..0 dBFS in 1 dB steps. */
  dynamicsCurve(id: number) {
    return this.call<{ points: { in_db: number; out_db: number }[] }>(OPS.dynamicsCurve, { id });
  }
  /** Join a mix group by name, or leave with `null`. */
  setTrackGroup(id: number, group: string | null) {
    return this.call(OPS.setTrackGroup, { id, group });
  }
  /** Solo or unsolo every member of a group as one undo step. */
  setGroupSolo(group: string, solo: boolean) {
    return this.call<{ tracks: number }>(OPS.setGroupSolo, { group, solo });
  }
  setGroupMuted(group: string, muted: boolean) {
    return this.call<{ tracks: number }>(OPS.setGroupMuted, { group, muted });
  }
  /** A solo-safe track keeps sounding while others are soloed, unless muted. */
  setSoloSafe(id: number, safe: boolean) {
    return this.call(OPS.setSoloSafe, { id, safe });
  }
  addAutomationPoint(track: number, param: AutomationParam, ticks: number, value: number) {
    return this.call<{ index: number }>(OPS.addAutomationPoint, { track, param, ticks, value });
  }
  /** Move a point between its neighbours; it keeps its index. */
  moveAutomationPoint(track: number, param: AutomationParam, index: number, ticks: number, value: number) {
    return this.call(OPS.moveAutomationPoint, { track, param, index, ticks, value });
  }
  removeAutomationPoint(track: number, param: AutomationParam, index: number) {
    return this.call(OPS.removeAutomationPoint, { track, param, index });
  }
  setAutomationMode(track: number, param: AutomationParam, mode: AutomationMode) {
    return this.call(OPS.setAutomationMode, { track, param, mode });
  }
  /** Set several velocities in one clip as one command and one undo step. */
  setVelocities(clip: number, changes: readonly { index: number; velocity: number }[]) {
    return this.call<{ changed: number }>(OPS.setVelocities, { clip, changes });
  }
  /** MIDI channel 0..15, shown to people as 1-16. */
  setNoteChannel(clip: number, index: number, channel: number) {
    return this.call(OPS.setNoteChannel, { clip, index, channel });
  }
  setMetronome(enabled: boolean, volume?: number) {
    return this.call(OPS.setMetronome, volume === undefined ? { enabled } : { enabled, volume });
  }
  /** Windowed peak/RMS of every track, bus and the master. Read-only. */
  meter(range: AnalysisRange, windowMs = 50) {
    return this.call<MeterResult>(OPS.meter, { ...analysisPayload(range), window_ms: windowMs });
  }
  /** BS.1770 loudness of the master. Read-only. */
  loudness(range: AnalysisRange) {
    return this.call<LoudnessResult>(OPS.loudness, analysisPayload(range));
  }
  /** Log-band spectrogram of the mono master. Read-only. */
  spectrogram(range: AnalysisRange, options: { fftSize?: number; hop?: number; bands?: number } = {}) {
    return this.call<SpectrogramResult>(OPS.spectrogram, {
      ...analysisPayload(range),
      fft_size: options.fftSize,
      hop: options.hop,
      bands: options.bands,
    });
  }
  project() {
    return this.call<ProjectInfo>(OPS.project);
  }
  /**
   * Offline-render the range to stereo f32 PCM. The metronome click is left
   * out unless `includeMetronome` is set, so bounces stay clean.
   */
  async render(fromTicks: number, toTicks: number, sampleRate = 44100, includeMetronome = false) {
    const r = await this.call<{ samples_b64: string; frames: number }>(
      OPS.render,
      { from_ticks: fromTicks, to_ticks: toTicks, sample_rate: sampleRate, include_metronome: includeMetronome },
    );
    return {
      samples: new Float32Array(base64ToBytes(r.data.samples_b64).buffer),
      frames: r.data.frames,
    };
  }
  /**
   * Offline-render the range to per-track/bus stereo stems. Each stem is the
   * track's post-fader output before it reaches the master, in document
   * order; muted or silent tracks return zeroed stems. Same range and
   * sample-rate bounds as `render`. Read-only.
   */
  async renderStems(fromTicks: number, toTicks: number, sampleRate = 44100) {
    const r = await this.call<{ stems_b64: string; frames: number; stems: { id: number }[] }>(
      OPS.renderStems,
      { from_ticks: fromTicks, to_ticks: toTicks, sample_rate: sampleRate },
    );
    const all = new Float32Array(base64ToBytes(r.data.stems_b64).buffer);
    const perStem = r.data.frames * 2;
    const stems = r.data.stems.map((s, i) => ({
      id: s.id,
      samples: all.subarray(i * perStem, (i + 1) * perStem),
    }));
    return { stems, frames: r.data.frames, channels: 2 as const };
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
