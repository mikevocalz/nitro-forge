// Pure mapping from NYC-Tron timeline gestures to Splice ops, and from the
// Splice `timeline` read to frame-based views. No engine here; the e2e file
// runs the same adapter against real Rust.
import { describe, expect, it } from "vitest";
import { batchOps, editOps, SPLICE_TRANSITION_PRESETS, timelineView } from "../src/timeline-cluster";
import { TRANSITION_KINDS } from "../src/index";

const R24 = { numerator: 24, denominator: 1 };
const NTSC = { numerator: 30000, denominator: 1001 };

describe("editOps", () => {
  it("maps each gesture to the engine ops in apply order", () => {
    expect(editOps({ kind: "move", clipId: "7", startSeconds: 2 })).toEqual([
      { op: "moveClip", payload: { id: 7, start_s: 2 } },
    ]);
    expect(
      editOps({ kind: "move", clipId: "7", startSeconds: 2, mode: "insert", targetTrackId: "3", scope: "all" }),
    ).toEqual([{ op: "moveClip", payload: { id: 7, start_s: 2, track: 3, mode: "insert", scope: "all" } }]);
    // Overwrite has no ripple, so scope is not sent.
    expect(editOps({ kind: "move", clipId: "7", startSeconds: 2, mode: "overwrite", scope: "all" })[0]!.payload)
      .toEqual({ id: 7, start_s: 2, mode: "overwrite" });
    const trim = { kind: "trim", clipId: "4", startSeconds: 1, inSeconds: 3, outSeconds: 5 } as const;
    expect(editOps({ ...trim, order: "trim-only" }).map((o) => o.op)).toEqual(["trimClip"]);
    expect(editOps({ ...trim, order: "trim-then-move" }).map((o) => o.op)).toEqual(["trimClip", "moveClip"]);
    expect(editOps({ ...trim, order: "move-then-trim" }).map((o) => o.op)).toEqual(["moveClip", "trimClip"]);
    expect(editOps({ kind: "split", clipId: "4", atSeconds: 1.5 })).toEqual([
      { op: "splitClip", payload: { id: 4, at_s: 1.5 } },
    ]);
    expect(editOps({ kind: "rippleTrim", clipId: "4", edge: "head", deltaSeconds: 0.5, scope: "track" })[0]).toEqual({
      op: "rippleTrim",
      payload: { id: 4, edge: "head", delta_s: 0.5, scope: "track" },
    });
    expect(editOps({ kind: "roll", leftClipId: "4", rightClipId: "5", deltaSeconds: -1 })[0]!.payload).toEqual({
      left: 4,
      right: 5,
      delta_s: -1,
    });
    expect(editOps({ kind: "slip", clipId: "4", deltaSeconds: 2 })[0]!.op).toBe("slipClip");
    expect(editOps({ kind: "slide", clipId: "4", deltaSeconds: 2 })[0]!.op).toBe("slideClip");
    expect(editOps({ kind: "rippleDelete", clipId: "4", scope: "all" })[0]!.payload).toEqual({ id: 4, scope: "all" });
    expect(() => editOps({ kind: "slip", clipId: "abc", deltaSeconds: 1 })).toThrow(/Not a Splice id/);
  });
});

describe("batchOps", () => {
  const starts = new Map([
    ["1", 0],
    ["2", 2],
    ["3", 4],
  ]);
  it("moves the latest clip first when shifting later, the earliest first when earlier", () => {
    const later = batchOps(
      [
        { kind: "move", clipId: "1", startSeconds: 1 },
        { kind: "move", clipId: "3", startSeconds: 5 },
        { kind: "move", clipId: "2", startSeconds: 3 },
      ],
      starts,
    );
    expect(later.map((o) => o.payload.id)).toEqual([3, 2, 1]);
    const earlier = batchOps(
      [
        { kind: "move", clipId: "3", startSeconds: 3 },
        { kind: "move", clipId: "2", startSeconds: 1 },
      ],
      starts,
    );
    expect(earlier.map((o) => o.payload.id)).toEqual([2, 3]);
  });
  it("maps speed, remove and ripple delete", () => {
    expect(
      batchOps(
        [
          { kind: "speed", clipId: "1", speed: 2 },
          { kind: "remove", clipId: "2" },
          { kind: "rippleDelete", clipId: "3", scope: "track" },
        ],
        starts,
      ),
    ).toEqual([
      { op: "setSpeed", payload: { id: 1, speed: 2 } },
      { op: "removeClip", payload: { id: 2 } },
      { op: "rippleDelete", payload: { id: 3, scope: "track" } },
    ]);
  });
});

describe("timelineView", () => {
  const raw = {
    sources: { "1": { name: "harbor.mov", duration_s: 10 } },
    tracks: [
      {
        id: 2,
        kind: "video" as const,
        locked: true,
        clips: [
          { id: 5, source_id: 1, timeline_start_s: 2, in_s: 4, out_s: 6, speed: 1 },
          { id: 4, source_id: 1, timeline_start_s: 0, in_s: 0, out_s: 4, speed: 2 },
        ],
        transitions: [{ id: 9, left_id: 4, right_id: 5, kind: "cross_dissolve" as const, duration_s: 0.5 }],
      },
      { id: 3, kind: "audio" as const, name: "Room tone", solo: true, clips: [] },
      { id: 6, kind: "overlay" as const, clips: [] },
    ],
    markers: [
      { id: 10, time_s: 1, name: "Beat" },
      { id: 11, time_s: 2, duration_s: 1, name: "Chorus", note: "Lift" },
    ],
    loop_range: { in_s: 0.5, out_s: 3 },
  };
  it("converts seconds to frames and fills header defaults", () => {
    const v = timelineView(raw, R24);
    expect(v.tracks.map((t) => t.label)).toEqual(["V1", "Room tone", "O1"]);
    expect(v.tracks[0]!.locked).toBe(true);
    expect(v.tracks[1]!.solo).toBe(true);
    expect(v.tracks[0]!.clips.map((c) => [c.id, c.startFrame, c.sourceIn, c.sourceOut])).toEqual([
      ["4", 0, 0, 96],
      ["5", 48, 96, 144],
    ]);
    expect(v.tracks[0]!.clips[0]!).toMatchObject({ label: "harbor.mov", sourceDuration: 240, speed: 2 });
    expect(v.transitions).toEqual([
      { id: "9", trackId: "2", leftClipId: "4", rightClipId: "5", kind: "cross_dissolve", durationFrames: 12 },
    ]);
    expect(v.markers).toEqual([
      { id: "10", frame: 24, name: "Beat" },
      { id: "11", frame: 48, durationFrames: 24, name: "Chorus", note: "Lift" },
    ]);
    expect(v.loopRange).toEqual({ inFrame: 12, outFrame: 72 });
    expect(v.durationFrames).toBe(96);
  });
  it("lands NTSC starts on whole frames", () => {
    const v = timelineView(
      { sources: raw.sources, tracks: [{ id: 2, kind: "video", clips: [{ id: 4, source_id: 1, timeline_start_s: 1001 / 30000 * 7, in_s: 0, out_s: 1, speed: 1 }] }] },
      NTSC,
    );
    expect(v.tracks[0]!.clips[0]!.startFrame).toBe(7);
  });
});

describe("transition presets", () => {
  it("lists exactly the kinds the engine accepts", () => {
    expect(SPLICE_TRANSITION_PRESETS.map((p) => p.kind)).toEqual([...TRANSITION_KINDS]);
    expect(SPLICE_TRANSITION_PRESETS.filter((p) => p.tracks === "audio").map((p) => p.kind)).toEqual(["cross_fade"]);
  });
});
