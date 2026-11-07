import type { EngineHost } from "@nitro-forge/ignition";
import { CadenceDocument } from "./index";
import {
  createCadenceTrackInstrumentBindings,
  toNativeKnobBinding,
  type CadenceKnobBinding,
  type CadenceNativeKnobBinding,
} from "./instrument-adapter";

/** One real Cadence track. Every value comes from the latest Rust describe() result. */
export interface CadenceInstrumentState {
  readonly trackId: number;
  readonly trackName: string;
  readonly gain: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly tempoBpm: number;
}
export type CadenceInstrumentListener = (state: Readonly<CadenceInstrumentState>) => void;

interface EngineTrack {
  id: number;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}
interface EngineProject {
  tempo_bpm: number;
  tracks: EngineTrack[];
}
export interface CadenceInstrumentOptions {
  readonly trackName?: string;
  readonly tempoBpm?: number;
}

function readActualTrack(
  project: EngineProject,
  id: number,
): Readonly<CadenceInstrumentState> {
  const track = project.tracks?.find((item) => item.id === id);
  if (!track) throw new Error("Cadence engine did not return the owned track");
  if (
    ![track.volume, track.pan, project.tempo_bpm].every(Number.isFinite) ||
    track.volume < 0 || track.volume > 1 ||
    track.pan < -1 || track.pan > 1
  ) {
    throw new Error("Cadence engine returned an invalid track state");
  }
  return Object.freeze({
    trackId: track.id,
    trackName: track.name,
    gain: track.volume,
    pan: track.pan,
    muted: track.muted,
    solo: track.solo,
    tempoBpm: project.tempo_bpm,
  });
}

/**
 * High-level controller for NYC-Tron's iOS SwiftUI / Android Compose knobs.
 *
 * No second undo stack or optimistic document values. Preview stays local to
 * the native view. Commit => serialized Rust mutation => actual describe().
 */
export class CadenceInstrumentSession {
  private readonly listeners = new Set<CadenceInstrumentListener>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private closed = false;
  private current: Readonly<CadenceInstrumentState>;

  private constructor(
    private readonly document: CadenceDocument,
    readonly trackId: number,
    state: Readonly<CadenceInstrumentState>,
  ) {
    this.current = state;
  }

  static async open(
    host: EngineHost,
    options: CadenceInstrumentOptions = {},
  ): Promise<CadenceInstrumentSession> {
    const tempo = options.tempoBpm ?? 120;
    const name = options.trackName ?? "Instrument 1";
    if (!Number.isFinite(tempo) || tempo < 20 || tempo > 400)
      throw new RangeError("Cadence tempo must be 20..400 BPM");
    if (!name.trim()) throw new RangeError("Track name is required");
    const document = await CadenceDocument.open(host, tempo);
    try {
      const trackId = (await document.addTrack("midi", name)).data.track_id;
      // Session setup is the baseline, not a user edit. Round-tripping the
      // initialized snapshot clears setup history without deleting its track.
      await document.handle.restore(await document.save());
      const result = await document.describe<EngineProject>();
      const state = readActualTrack(result.data, trackId);
      return new CadenceInstrumentSession(document, trackId, state);
    } catch (error) {
      await document.close();
      throw error;
    }
  }

  /** The last successfully acknowledged engine value (never an animation preview). */
  get state(): Readonly<CadenceInstrumentState> {
    return this.current;
  }

  subscribe(listener: CadenceInstrumentListener): () => void {
    if (this.closing) throw new Error("Cadence instrument session is closing");
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Props for `InstrumentKnob` (`@nyc-tron/ui`). Each commit is serialized,
   * applied to the Rust document and followed by describe().
   */
  get knobs(): {
    readonly gain: CadenceKnobBinding<Readonly<CadenceInstrumentState>>;
    readonly pan: CadenceKnobBinding<Readonly<CadenceInstrumentState>>;
  } {
    const bindings = createCadenceTrackInstrumentBindings(this.document, this.trackId);
    return {
      gain: { ...bindings.gain, onCommit: (value: number) => this.setGain(value) },
      pan: { ...bindings.pan, onCommit: (value: number) => this.setPan(value) },
    };
  }

  /** Props for the SwiftUI / Compose `ArcKnob` (`@nyc-tron/native-controls`). Same commit path as {@linkcode knobs}. */
  get controls(): {
    readonly gain: CadenceNativeKnobBinding<Readonly<CadenceInstrumentState>>;
    readonly pan: CadenceNativeKnobBinding<Readonly<CadenceInstrumentState>>;
  } {
    const knobs = this.knobs;
    return {
      gain: toNativeKnobBinding(knobs.gain, knobs.gain.onCommit),
      pan: toNativeKnobBinding(knobs.pan, knobs.pan.onCommit),
    };
  }

  /** Normalized props for NYC-Tron's existing InstrumentXYPad: X is pan,
   * Y is gain. Both coordinates are committed as one engine transaction. */
  get xyPad() {
    return {
      x: (this.current.pan + 1) / 2,
      y: this.current.gain,
      step: 0.01,
      onCommit: (point: { x: number; y: number }) => this.setGainAndPan(point.y, point.x * 2 - 1),
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Cadence session is closed"));
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async syncFromEngine(): Promise<Readonly<CadenceInstrumentState>> {
    const described = await this.document.describe<EngineProject>();
    this.current = readActualTrack(described.data, this.trackId);
    // A bad React listener must not turn a successful Rust edit into a rejected
    // command or cause a duplicate tap-to-retry.
    for (const listener of Array.from(this.listeners)) {
      try { listener(this.current); } catch { /* UI lifecycle owns listener errors */ }
    }
    return this.current;
  }

  private async mutate(
    property: "gain" | "pan",
    value: number,
  ): Promise<Readonly<CadenceInstrumentState>> {
    const binding = createCadenceTrackInstrumentBindings(this.document, this.trackId);
    // Validate before enqueue, never emit a preview as a persisted value.
    const { min, max } = property === "gain" ? binding.gain : binding.pan;
    if (!Number.isFinite(value) || value < min || value > max)
      return Promise.reject(new RangeError(property + " value is out of range"));
    return this.enqueue(async () => {
      if (property === "gain") await binding.gain.onCommit(value);
      else await binding.pan.onCommit(value);
      return this.syncFromEngine();
    });
  }

  setGain(value: number) { return this.mutate("gain", value); }
  setPan(value: number) { return this.mutate("pan", value); }
  setGainAndPan(gain: number, pan: number): Promise<Readonly<CadenceInstrumentState>> {
    if (!Number.isFinite(gain) || gain < 0 || gain > 1 || !Number.isFinite(pan) || pan < -1 || pan > 1)
      return Promise.reject(new RangeError("Gain/pan values are out of range"));
    return this.enqueue(async () => {
      await this.document.handle.applyBatch([
        { op: "setTrackGain", payload: { id: this.trackId, volume: gain } },
        { op: "setTrackPan", payload: { id: this.trackId, pan } },
      ]);
      return this.syncFromEngine();
    });
  }
  refresh() { return this.enqueue(() => this.syncFromEngine()); }

  undo(): Promise<boolean> {
    return this.enqueue(async () => {
      const didUndo = await this.document.undo();
      if (didUndo) await this.syncFromEngine();
      return didUndo;
    });
  }

  redo(): Promise<boolean> {
    return this.enqueue(async () => {
      const didRedo = await this.document.redo();
      if (didRedo) await this.syncFromEngine();
      return didRedo;
    });
  }

  save(): Promise<Uint8Array> {
    return this.enqueue(() => this.document.save());
  }

  async close(): Promise<void> {
    if (this.closing) {
      await this.tail;
      return;
    }
    this.closing = true;
    await this.tail;
    if (!this.closed) {
      this.closed = true;
      this.listeners.clear();
      await this.document.close();
    }
  }
}
