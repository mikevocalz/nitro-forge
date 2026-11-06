import type { BatchableOp, RippleScope, SpliceDocument, TrackKind, TransitionKind } from "./index";

/**
 * Engine side of NYC-Tron's timeline controls (Forge roster section D). Like
 * Pitch's `office-cluster`, this file imports no React and no `@nyc-tron/*`
 * package at runtime: it reads Splice into the shapes the NYC-Tron props take
 * (whole frames at the sequence rate) and maps each finished UI gesture onto
 * Splice ops (seconds). Every write goes to the engine first and the view is
 * re-read afterwards; nothing is applied optimistically, and an engine error
 * rejects with the engine's message.
 *
 * Gestures that need two engine ops (a head trim is `trimClip` plus
 * `moveClip`) and the batch panel's multi-clip edits go through Splice's
 * `batch`, so each gesture is one undo step.
 */

/** A frame rate as NYC-Tron's `forge/timebase` `FrameRate` takes it. */
export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

/** A clip as NYC-Tron `TimelineClip` takes it. Ids are the engine's numeric ids as strings. */
export interface TimelineClipView {
  readonly id: string;
  readonly startFrame: number;
  readonly sourceIn: number;
  readonly sourceOut: number;
  readonly speed: number;
  readonly sourceDuration: number;
  readonly label: string;
}

/** A track as NYC-Tron `TimelineTrack` takes it, with the header flags. */
export interface TimelineTrackView {
  readonly id: string;
  readonly kind: TrackKind;
  readonly label: string;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly clips: readonly TimelineClipView[];
}

/** A transition as NYC-Tron `TimelineTransition` takes it. */
export interface TimelineTransitionView {
  readonly id: string;
  readonly trackId: string;
  readonly leftClipId: string;
  readonly rightClipId: string;
  readonly kind: TransitionKind;
  readonly durationFrames: number;
}

/** A marker as NYC-Tron `TimelineMarker` takes it. `durationFrames` is absent for a point marker. */
export interface TimelineMarkerView {
  readonly id: string;
  readonly frame: number;
  readonly durationFrames?: number;
  readonly name: string;
  readonly note?: string;
}

/** Everything the timeline controls draw, read from one `timeline` call. */
export interface SpliceTimelineView {
  readonly tracks: readonly TimelineTrackView[];
  readonly transitions: readonly TimelineTransitionView[];
  readonly markers: readonly TimelineMarkerView[];
  readonly loopRange?: { readonly inFrame: number; readonly outFrame: number };
  /** Frames to the end of the last clip, rounded up. */
  readonly durationFrames: number;
}

/**
 * One finished timeline gesture: NYC-Tron's `TimelineEdit` union. Only the
 * fields the engine needs are listed; the UI's extra frame fields are allowed.
 */
export type TimelineEditInput =
  | {
      readonly kind: "move";
      readonly clipId: string;
      readonly startSeconds: number;
      readonly mode?: "insert" | "overwrite";
      readonly targetTrackId?: string;
      readonly scope?: RippleScope;
    }
  | {
      readonly kind: "trim";
      readonly clipId: string;
      readonly startSeconds: number;
      readonly inSeconds: number;
      readonly outSeconds: number;
      readonly order: "trim-only" | "trim-then-move" | "move-then-trim";
    }
  | { readonly kind: "split"; readonly clipId: string; readonly atSeconds: number }
  | { readonly kind: "rippleDelete"; readonly clipId: string; readonly scope: RippleScope }
  | {
      readonly kind: "rippleTrim";
      readonly clipId: string;
      readonly edge: "head" | "tail";
      readonly deltaSeconds: number;
      readonly scope: RippleScope;
    }
  | {
      readonly kind: "roll";
      readonly leftClipId: string;
      readonly rightClipId: string;
      readonly deltaSeconds: number;
    }
  /** `deltaSeconds` is media time. */
  | { readonly kind: "slip"; readonly clipId: string; readonly deltaSeconds: number }
  | { readonly kind: "slide"; readonly clipId: string; readonly deltaSeconds: number };

/** One row of NYC-Tron's `BatchEditPanel` output. */
export type BatchEditInput =
  | { readonly kind: "move"; readonly clipId: string; readonly startSeconds: number }
  | { readonly kind: "speed"; readonly clipId: string; readonly speed: number }
  | { readonly kind: "remove"; readonly clipId: string }
  | { readonly kind: "rippleDelete"; readonly clipId: string; readonly scope: RippleScope };

/** Header flags NYC-Tron `TrackHeaders` toggles. */
export type TrackFlag = "locked" | "hidden" | "muted" | "solo";

/** The transitions `TransitionPresetBrowser` lists: every kind `addTransition` accepts. */
export const SPLICE_TRANSITION_PRESETS = [
  { kind: "cross_dissolve", label: "Cross dissolve", description: "Blends the outgoing shot into the incoming one.", tracks: "visual" },
  { kind: "dip_to_black", label: "Dip to black", description: "Fades out to black, then in from black.", tracks: "visual" },
  { kind: "dip_to_white", label: "Dip to white", description: "Fades out to white, then in from white.", tracks: "visual" },
  { kind: "wipe_left", label: "Wipe left", description: "An edge crosses right to left, revealing the incoming shot.", tracks: "visual" },
  { kind: "wipe_right", label: "Wipe right", description: "An edge crosses left to right, revealing the incoming shot.", tracks: "visual" },
  { kind: "push_left", label: "Push left", description: "The incoming shot pushes the outgoing one off to the left.", tracks: "visual" },
  { kind: "push_right", label: "Push right", description: "The incoming shot pushes the outgoing one off to the right.", tracks: "visual" },
  { kind: "cross_fade", label: "Cross fade", description: "Fades the outgoing sound out while the incoming one fades in.", tracks: "audio" },
] as const satisfies readonly {
  kind: TransitionKind;
  label: string;
  description: string;
  tracks: "visual" | "audio";
}[];

/**
 * Timeline controls the engine cannot back yet. Each is a DEFER or STRIKE:
 * the matching NYC-Tron control is left out, never drawn as a dead button.
 */
export const SPLICE_DEFERRED = {
  /** D-03, D-28: no compositor renders `renderPlan`, so there is no program image or render cache. */
  compositor: ["D-03", "D-28"],
  /** D-16, D-17, D-26, D-30, D-40, D-42: no decoder backend yields frames, thumbnails, audio peaks or media probes. */
  decoder: ["D-16", "D-17", "D-26", "D-30", "D-40", "D-42"],
  /** D-29: no encoder/export backend consumes `renderPlan`. */
  encoder: ["D-29"],
  /** D-31 effects/adjustment tracks: no video effects pipeline (D-38). Overlay tracks are supported. */
  effectTracks: ["D-31"],
  /** D-43: no sticker asset source, and nothing composites stickers. */
  stickerTracks: ["D-43"],
  /** D-32: Splice speed is constant per clip; keyframed speed is not built. */
  speedKeyframes: ["D-32"],
} as const;

interface RawClip {
  id: number;
  source_id: number;
  timeline_start_s: number;
  in_s: number;
  out_s: number;
  speed: number;
}
interface RawTimeline {
  sources: Record<string, { name: string; duration_s: number }>;
  tracks: {
    id: number;
    kind: TrackKind;
    name?: string;
    locked?: boolean;
    hidden?: boolean;
    muted?: boolean;
    solo?: boolean;
    clips: RawClip[];
    transitions?: { id: number; left_id: number; right_id: number; kind: TransitionKind; duration_s: number }[];
  }[];
  markers?: { id: number; time_s: number; duration_s?: number; name: string; note?: string }[];
  loop_range?: { in_s: number; out_s: number };
}

const fpsOf = (rate: FrameRate) => {
  if (!(rate.numerator > 0 && rate.denominator > 0)) throw new RangeError("Frame rate must be positive");
  return rate.numerator / rate.denominator;
};
/** Whole frame at `seconds`, rounding away float error from the engine's seconds. */
const frameAt = (seconds: number, fps: number) => Math.round(seconds * fps);
const TRACK_PREFIX: Record<TrackKind, string> = { video: "V", audio: "A", overlay: "O" };
const engineId = (id: string) => {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Not a Splice id: ${id}`);
  return n;
};

/** Map Splice's `timeline` read to the frame-based views NYC-Tron draws. */
export function timelineView(raw: RawTimeline, rate: FrameRate): SpliceTimelineView {
  const fps = fpsOf(rate);
  const counts: Record<TrackKind, number> = { video: 0, audio: 0, overlay: 0 };
  let endS = 0;
  const tracks = raw.tracks.map((t) => {
    counts[t.kind] += 1;
    const clips = [...t.clips]
      .sort((a, b) => a.timeline_start_s - b.timeline_start_s)
      .map((c): TimelineClipView => {
        const src = raw.sources[String(c.source_id)];
        endS = Math.max(endS, c.timeline_start_s + (c.out_s - c.in_s) / c.speed);
        return {
          id: String(c.id),
          startFrame: frameAt(c.timeline_start_s, fps),
          sourceIn: c.in_s * fps,
          sourceOut: c.out_s * fps,
          speed: c.speed,
          sourceDuration: (src?.duration_s ?? c.out_s) * fps,
          label: src?.name ?? `Clip ${c.id}`,
        };
      });
    return {
      id: String(t.id),
      kind: t.kind,
      label: t.name ?? `${TRACK_PREFIX[t.kind]}${counts[t.kind]}`,
      locked: t.locked ?? false,
      hidden: t.hidden ?? false,
      muted: t.muted ?? false,
      solo: t.solo ?? false,
      clips,
    };
  });
  const transitions = raw.tracks.flatMap((t) =>
    (t.transitions ?? []).map((x) => ({
      id: String(x.id),
      trackId: String(t.id),
      leftClipId: String(x.left_id),
      rightClipId: String(x.right_id),
      kind: x.kind,
      durationFrames: frameAt(x.duration_s, fps),
    })),
  );
  const markers = (raw.markers ?? []).map((m): TimelineMarkerView => ({
    id: String(m.id),
    frame: frameAt(m.time_s, fps),
    ...(m.duration_s ? { durationFrames: frameAt(m.duration_s, fps) } : {}),
    name: m.name,
    ...(m.note ? { note: m.note } : {}),
  }));
  return {
    tracks,
    transitions,
    markers,
    ...(raw.loop_range
      ? { loopRange: { inFrame: frameAt(raw.loop_range.in_s, fps), outFrame: frameAt(raw.loop_range.out_s, fps) } }
      : {}),
    durationFrames: Math.ceil(endS * fps - 1e-6),
  };
}

type Op = { op: BatchableOp; payload: Record<string, unknown> };

/** The Splice ops for one gesture, in apply order. */
export function editOps(edit: TimelineEditInput): Op[] {
  switch (edit.kind) {
    case "move": {
      const payload: Record<string, unknown> = { id: engineId(edit.clipId), start_s: edit.startSeconds };
      if (edit.targetTrackId !== undefined) payload.track = engineId(edit.targetTrackId);
      if (edit.mode !== undefined) payload.mode = edit.mode;
      if (edit.mode === "insert" && edit.scope !== undefined) payload.scope = edit.scope;
      return [{ op: "moveClip", payload }];
    }
    case "trim": {
      const id = engineId(edit.clipId);
      const trim: Op = { op: "trimClip", payload: { id, in_s: edit.inSeconds, out_s: edit.outSeconds } };
      const move: Op = { op: "moveClip", payload: { id, start_s: edit.startSeconds } };
      if (edit.order === "trim-only") return [trim];
      return edit.order === "trim-then-move" ? [trim, move] : [move, trim];
    }
    case "split":
      return [{ op: "splitClip", payload: { id: engineId(edit.clipId), at_s: edit.atSeconds } }];
    case "rippleDelete":
      return [{ op: "rippleDelete", payload: { id: engineId(edit.clipId), scope: edit.scope } }];
    case "rippleTrim":
      return [
        {
          op: "rippleTrim",
          payload: { id: engineId(edit.clipId), edge: edit.edge, delta_s: edit.deltaSeconds, scope: edit.scope },
        },
      ];
    case "roll":
      return [
        {
          op: "rollEdit",
          payload: { left: engineId(edit.leftClipId), right: engineId(edit.rightClipId), delta_s: edit.deltaSeconds },
        },
      ];
    case "slip":
      return [{ op: "slipClip", payload: { id: engineId(edit.clipId), delta_s: edit.deltaSeconds } }];
    case "slide":
      return [{ op: "slideClip", payload: { id: engineId(edit.clipId), delta_s: edit.deltaSeconds } }];
  }
}

/**
 * The Splice ops for a batch-panel apply. Moves are ordered so no clip passes
 * through another selected clip on the way: a shift later moves the latest
 * clip first, a shift earlier the earliest first. `startsByClip` gives each
 * moved clip's current start in seconds.
 */
export function batchOps(edits: readonly BatchEditInput[], startsByClip: ReadonlyMap<string, number>): Op[] {
  const moves = edits.filter((e): e is Extract<BatchEditInput, { kind: "move" }> => e.kind === "move");
  const later = moves.some((m) => m.startSeconds > (startsByClip.get(m.clipId) ?? 0));
  const ordered = [...moves].sort((a, b) => {
    const da = startsByClip.get(a.clipId) ?? 0;
    const db = startsByClip.get(b.clipId) ?? 0;
    return later ? db - da : da - db;
  });
  const rest = edits.filter((e) => e.kind !== "move");
  return [...ordered, ...rest].map((e): Op => {
    const id = engineId(e.clipId);
    switch (e.kind) {
      case "move":
        return { op: "moveClip", payload: { id, start_s: e.startSeconds } };
      case "speed":
        return { op: "setSpeed", payload: { id, speed: e.speed } };
      case "remove":
        return { op: "removeClip", payload: { id } };
      case "rippleDelete":
        return { op: "rippleDelete", payload: { id, scope: e.scope } };
    }
  });
}

/**
 * A Splice document bound to the timeline controls at one frame rate. Each
 * method writes to the engine, then returns a fresh {@link SpliceTimelineView}.
 */
export class SpliceTimelineAdapter {
  constructor(
    private readonly doc: SpliceDocument,
    readonly rate: FrameRate,
  ) {
    fpsOf(rate);
  }

  async read(): Promise<SpliceTimelineView> {
    return timelineView((await this.doc.timeline<RawTimeline>()).data, this.rate);
  }

  private async run(ops: Op[]): Promise<SpliceTimelineView> {
    if (ops.length === 1) {
      const [{ op, payload }] = ops as [Op];
      await this.doc.handle.apply(op, payload);
    } else if (ops.length > 1) {
      await this.doc.batch(ops);
    }
    return this.read();
  }

  /** `TimelineClipLane`, `ClipTrimHandles`, `RazorSplitTool`, `RollSlipSlideControls`, `DragReorderAndRipple`: one gesture, one undo step. */
  applyEdit(edit: TimelineEditInput): Promise<SpliceTimelineView> {
    return this.run(editOps(edit));
  }

  /** `BatchEditPanel`: every row in one `batch`, one undo step. */
  async applyBatch(edits: readonly BatchEditInput[]): Promise<SpliceTimelineView> {
    if (edits.length === 0) return this.read();
    const view = await this.read();
    const fps = fpsOf(this.rate);
    const starts = new Map(view.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.startFrame / fps] as const)));
    return this.run(batchOps(edits, starts));
  }

  /** `TrackHeaders.onSetFlag`. */
  setTrackFlag(trackId: string, flag: TrackFlag, value: boolean): Promise<SpliceTimelineView> {
    return this.run([{ op: "setTrackFlags", payload: { id: engineId(trackId), [flag]: value } }]);
  }
  /** `TrackHeaders.onRename`. */
  renameTrack(trackId: string, name: string): Promise<SpliceTimelineView> {
    return this.run([{ op: "renameTrack", payload: { id: engineId(trackId), name } }]);
  }
  /** `TrackHeaders.onMove`. */
  moveTrack(trackId: string, toIndex: number): Promise<SpliceTimelineView> {
    return this.run([{ op: "moveTrack", payload: { id: engineId(trackId), index: toIndex } }]);
  }
  /** `OverlayAndEffectsTrackStack.onAddTrack`. */
  async addTrack(kind: TrackKind): Promise<SpliceTimelineView> {
    await this.doc.addTrack(kind);
    return this.read();
  }

  /** `TransitionHandles.onAdd` and `TransitionPresetBrowser.onApply` (with the selected cut). */
  addTransition(t: {
    leftClipId: string;
    rightClipId: string;
    kind: TransitionKind;
    durationSeconds: number;
  }): Promise<SpliceTimelineView> {
    return this.run([
      {
        op: "addTransition",
        payload: {
          left: engineId(t.leftClipId),
          right: engineId(t.rightClipId),
          kind: t.kind,
          duration_s: t.durationSeconds,
        },
      },
    ]);
  }
  /** `TransitionHandles.onChange`. */
  setTransition(id: string, change: { durationSeconds?: number; kind?: TransitionKind }): Promise<SpliceTimelineView> {
    const payload: Record<string, unknown> = { id: engineId(id) };
    if (change.durationSeconds !== undefined) payload.duration_s = change.durationSeconds;
    if (change.kind !== undefined) payload.kind = change.kind;
    return this.run([{ op: "setTransition", payload }]);
  }
  /** `TransitionHandles.onRemove`. */
  removeTransition(id: string): Promise<SpliceTimelineView> {
    return this.run([{ op: "removeTransition", payload: { id: engineId(id) } }]);
  }

  /** `TimelineMarkers.onAdd`. */
  addMarker(m: { seconds: number; durationSeconds?: number; name?: string; note?: string }): Promise<SpliceTimelineView> {
    const payload: Record<string, unknown> = { time_s: m.seconds };
    if (m.durationSeconds !== undefined) payload.duration_s = m.durationSeconds;
    if (m.name !== undefined) payload.name = m.name;
    if (m.note !== undefined) payload.note = m.note;
    return this.run([{ op: "addMarker", payload }]);
  }
  /** `TimelineMarkers.onUpdate`. */
  updateMarker(
    id: string,
    change: { seconds?: number; durationSeconds?: number; name?: string; note?: string },
  ): Promise<SpliceTimelineView> {
    const payload: Record<string, unknown> = { id: engineId(id) };
    if (change.seconds !== undefined) payload.time_s = change.seconds;
    if (change.durationSeconds !== undefined) payload.duration_s = change.durationSeconds;
    if (change.name !== undefined) payload.name = change.name;
    if (change.note !== undefined) payload.note = change.note;
    return this.run([{ op: "updateMarker", payload }]);
  }
  /** `TimelineMarkers.onRemove`. */
  removeMarker(id: string): Promise<SpliceTimelineView> {
    return this.run([{ op: "removeMarker", payload: { id: engineId(id) } }]);
  }

  /** `LoopRangeBar.onCommit`: a range stores it, `undefined` clears it. */
  setLoopRange(range: { inSeconds: number; outSeconds: number } | undefined): Promise<SpliceTimelineView> {
    return this.run(
      range === undefined
        ? [{ op: "clearLoopRange", payload: {} }]
        : [{ op: "setLoopRange", payload: { in_s: range.inSeconds, out_s: range.outSeconds } }],
    );
  }

  undo(): Promise<boolean> {
    return this.doc.undo();
  }
  redo(): Promise<boolean> {
    return this.doc.redo();
  }
}

/**
 * Controlled timeline callbacks bound to one adapter instance. Each resolves
 * with the authoritative engine view; the host publishes that view only on
 * success and handles rejected engine edits in its existing error surface.
 * Player rate/looping and UI selection remain owned by the host.
 */
export function timelineClusterCallbacks(adapter: SpliceTimelineAdapter) {
  return {
    onEdit: (edit: TimelineEditInput) => adapter.applyEdit(edit),
    onApply: (edits: readonly BatchEditInput[]) => adapter.applyBatch(edits),
    onSetFlag: (id: string, flag: TrackFlag, value: boolean) => adapter.setTrackFlag(id, flag, value),
    onRename: (id: string, name: string) => adapter.renameTrack(id, name),
    onMoveTrack: (id: string, index: number) => adapter.moveTrack(id, index),
    onAddTrack: (kind: TrackKind) => adapter.addTrack(kind),
    onAddTransition: (request: { leftClipId: string; rightClipId: string; kind: string; durationSeconds: number }) => {
      const preset = SPLICE_TRANSITION_PRESETS.find(p => p.kind === request.kind);
      if (!preset) return Promise.reject(new RangeError(`Unsupported transition: ${request.kind}`));
      return adapter.addTransition({ ...request, kind: preset.kind });
    },
    onChangeTransition: (id: string, change: { durationSeconds: number }) => adapter.setTransition(id, change),
    onRemoveTransition: (id: string) => adapter.removeTransition(id),
    onAddMarker: (at: { seconds: number }) => adapter.addMarker(at),
    onUpdateMarker: (id: string, change: { seconds: number; durationSeconds?: number; name?: string; note?: string }) => adapter.updateMarker(id, change),
    onRemoveMarker: (id: string) => adapter.removeMarker(id),
    onCommitLoop: (range: { inSeconds: number; outSeconds: number } | undefined) => adapter.setLoopRange(range),
  };
}
