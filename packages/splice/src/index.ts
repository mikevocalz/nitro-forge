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
  setTrackFlags: "setTrackFlags",
  renameTrack: "renameTrack",
  moveTrack: "moveTrack",
  rippleDelete: "rippleDelete",
  rippleTrim: "rippleTrim",
  rollEdit: "rollEdit",
  slipClip: "slipClip",
  slideClip: "slideClip",
  addTransition: "addTransition",
  setTransition: "setTransition",
  removeTransition: "removeTransition",
  addMarker: "addMarker",
  updateMarker: "updateMarker",
  removeMarker: "removeMarker",
  setLoopRange: "setLoopRange",
  clearLoopRange: "clearLoopRange",
  batch: "batch",
} as const;

/** Op names accepted inside {@link SpliceDocument.batch}. */
export type BatchableOp = Exclude<(typeof OPS)[keyof typeof OPS], "new" | "batch">;

/** `overlay` tracks hold picture composited above the video tracks. */
export type TrackKind = "video" | "audio" | "overlay";
/** Which tracks a ripple shifts: the edited clip's track, or every unlocked track. */
export type RippleScope = "track" | "all";
/**
 * How `addClip`/`moveClip` treat clips under the destination: `reject`
 * (default) refuses an overlap, `insert` pushes later clips right (splitting
 * one that straddles the point), `overwrite` trims, splits or removes them.
 */
export type PlacementMode = "reject" | "insert" | "overwrite";
/** Transition kinds Splice stores. `cross_fade` is the only audio kind. */
export const TRANSITION_KINDS = [
  "cross_dissolve",
  "dip_to_black",
  "dip_to_white",
  "wipe_left",
  "wipe_right",
  "push_left",
  "push_right",
  "cross_fade",
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
/** Track header flags. `hidden` is for video/overlay tracks; `muted` and `solo` for audio. */
export interface TrackFlags {
  locked?: boolean;
  hidden?: boolean;
  muted?: boolean;
  solo?: boolean;
}
/** Every clip-editing op may report transitions it dropped because the edit broke their cut. */
export interface ClipEditResult {
  ok?: true;
  removed_transitions?: number[];
}

export class SpliceDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost, fps = 30): Promise<SpliceDocument> {
    const doc = await DocumentHandle.openInitialized(host, "splice",
      (document) => document.apply(OPS.newDoc, { fps }));
    return new SpliceDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<SpliceDocument> {
    const doc = await DocumentHandle.openInitialized(host, "splice",
      (document) => document.restore(bytes));
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
    mode?: PlacementMode;
    scope?: RippleScope;
  }) {
    return this.call<{ clip_id: number; created: number[] } & ClipEditResult>(
      OPS.addClip,
      args,
    );
  }
  removeClip(id: number) {
    return this.call<ClipEditResult>(OPS.removeClip, { id });
  }
  /**
   * Move a clip, optionally to another track of the same media class (audio
   * with audio; video with overlay). `created` lists clips that insert or
   * overwrite split off.
   */
  moveClip(
    id: number,
    startS: number,
    opts: { track?: number; mode?: PlacementMode; scope?: RippleScope } = {},
  ) {
    return this.call<{ created: number[] } & ClipEditResult>(OPS.moveClip, {
      id,
      start_s: startS,
      ...opts,
    });
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
    return this.call<ClipEditResult>(OPS.setSpeed, { id, speed });
  }

  // ---- track headers ------------------------------------------------------
  /** `changed: false` (and no undo entry) when the flags already matched. */
  setTrackFlags(id: number, flags: TrackFlags) {
    return this.call<{ ok: true; changed: boolean }>(OPS.setTrackFlags, { id, ...flags });
  }
  renameTrack(id: number, name: string) {
    return this.call<{ ok: true; changed: boolean }>(OPS.renameTrack, { id, name });
  }
  /** Put the track at `index` in the stack (0 = first). */
  moveTrack(id: number, index: number) {
    return this.call<{ ok: true; changed: boolean }>(OPS.moveTrack, { id, index });
  }

  // ---- multi-clip edits (each one undo step) ---------------------------------
  /** Remove a clip and close its gap. */
  rippleDelete(id: number, scope: RippleScope = "track") {
    return this.call<ClipEditResult>(OPS.rippleDelete, { id, scope });
  }
  /**
   * Move one edge by `deltaS` timeline seconds (positive = later) and shift
   * everything after the clip by the change in length. A head trim keeps the
   * clip's start and moves its in-point.
   */
  rippleTrim(id: number, edge: "head" | "tail", deltaS: number, scope: RippleScope = "track") {
    return this.call<ClipEditResult>(OPS.rippleTrim, { id, edge, delta_s: deltaS, scope });
  }
  /** Move the cut between two touching clips by `deltaS`. */
  rollEdit(left: number, right: number, deltaS: number) {
    return this.call<ClipEditResult>(OPS.rollEdit, { left, right, delta_s: deltaS });
  }
  /** Shift the clip's media by `deltaS` media seconds, keeping its timeline slot. */
  slipClip(id: number, deltaS: number) {
    return this.call<ClipEditResult>(OPS.slipClip, { id, delta_s: deltaS });
  }
  /** Move the clip by `deltaS`; touching neighbours give or take the difference. */
  slideClip(id: number, deltaS: number) {
    return this.call<ClipEditResult>(OPS.slideClip, { id, delta_s: deltaS });
  }

  // ---- transitions ------------------------------------------------------------
  addTransition(left: number, right: number, kind: TransitionKind, durationS: number) {
    return this.call<{ transition_id: number }>(OPS.addTransition, {
      left,
      right,
      kind,
      duration_s: durationS,
    });
  }
  setTransition(id: number, change: { kind?: TransitionKind; duration_s?: number }) {
    return this.call(OPS.setTransition, { id, ...change });
  }
  removeTransition(id: number) {
    return this.call(OPS.removeTransition, { id });
  }

  // ---- markers and loop range ------------------------------------------------
  addMarker(args: { time_s: number; duration_s?: number; name?: string; note?: string }) {
    return this.call<{ marker_id: number }>(OPS.addMarker, args);
  }
  updateMarker(
    id: number,
    change: { time_s?: number; duration_s?: number; name?: string; note?: string },
  ) {
    return this.call(OPS.updateMarker, { id, ...change });
  }
  removeMarker(id: number) {
    return this.call(OPS.removeMarker, { id });
  }
  setLoopRange(inS: number, outS: number) {
    return this.call(OPS.setLoopRange, { in_s: inS, out_s: outS });
  }
  clearLoopRange() {
    return this.call(OPS.clearLoopRange, {});
  }

  /**
   * Run several ops as one undo step. Either all apply or none do; the error
   * names the failing op as `ops[i] <op>: ...`.
   */
  batch(ops: readonly { op: BatchableOp; payload?: unknown }[]) {
    return this.call<{ results: unknown[] }>(OPS.batch, { ops });
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
