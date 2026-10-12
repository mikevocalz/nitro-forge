import {
  DocumentHandle,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — mirrors docs/ENGINE_OPS.md § splice. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  addSource: "addSource",
  removeSource: "removeSource",
  addTrack: "addTrack",
  removeTrack: "removeTrack",
  addClip: "addClip",
  removeClip: "removeClip",
  moveClip: "moveClip",
  trimClip: "trimClip",
  splitClip: "splitClip",
  setSpeed: "setSpeed",
  duration: "duration",
  timeline: "timeline",
  renderPlan: "renderPlan",
} as const;

export type TrackKind = "video" | "audio";

export class SpliceDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost, fps = 30): Promise<SpliceDocument> {
    const doc = await DocumentHandle.open(host, "splice");
    await doc.apply(OPS.newDoc, { fps });
    return new SpliceDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<SpliceDocument> {
    const doc = await DocumentHandle.open(host, "splice");
    await doc.restore(bytes);
    return new SpliceDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }
  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  addSource(durationS: number, name?: string) {
    return this.call<{ source_id: number }>(OPS.addSource, {
      duration_s: durationS,
      name,
    });
  }
  removeSource(id: number) {
    return this.call(OPS.removeSource, { id });
  }
  addTrack(kind: TrackKind) {
    return this.call<{ track_id: number }>(OPS.addTrack, { kind });
  }
  removeTrack(id: number) {
    return this.call(OPS.removeTrack, { id });
  }
  addClip(args: {
    track: number;
    source: number;
    in_s: number;
    out_s: number;
    speed?: number;
    start_s?: number;
  }) {
    return this.call<{ clip_id: number }>(OPS.addClip, args);
  }
  removeClip(id: number) {
    return this.call(OPS.removeClip, { id });
  }
  moveClip(id: number, startS: number) {
    return this.call(OPS.moveClip, { id, start_s: startS });
  }
  trimClip(id: number, in_s?: number, out_s?: number) {
    return this.call(OPS.trimClip, { id, in_s, out_s });
  }
  splitClip(id: number, atS: number) {
    return this.call<{ left_id: number; right_id: number }>(OPS.splitClip, {
      id,
      at_s: atS,
    });
  }
  setSpeed(id: number, speed: number) {
    return this.call(OPS.setSpeed, { id, speed });
  }
  duration() {
    return this.call<{ seconds: number }>(OPS.duration);
  }
  timeline<T = unknown>() {
    return this.call<T>(OPS.timeline);
  }
  renderPlan<T = unknown>() {
    return this.call<T>(OPS.renderPlan);
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
