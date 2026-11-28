import type { DocumentHandle, EngineHost } from "@nitro-forge/ignition";
import { PrismDocument } from "@nitro-forge/prism";
import { CadenceDocument } from "@nitro-forge/cadence";
import { SpliceDocument } from "@nitro-forge/splice";
import { FolioDocument } from "@nitro-forge/folio";
import { PitchDocument } from "@nitro-forge/pitch";
import { TallyDocument } from "@nitro-forge/tally";
import { QuillDocument } from "@nitro-forge/quill";
import { PhotoDocument } from "@nitro-forge/photo";
import { MotionDocument } from "@nitro-forge/motion";
import { DesignDocument } from "@nitro-forge/design";
import { DraftDocument } from "@nitro-forge/draft";
import type { EditorDoc } from "./useDocument";
import { actionTitles, studioRows, type Row } from "./editor-copy";

export type { Row } from "./editor-copy";
export interface Action {
  /** Stable id for tests (`workspace-action-<id>`); the title is the user's label. */
  id: string;
  title: string;
  run: (doc: EditorDoc) => Promise<unknown> | unknown;
}
export interface EditorConfig {
  title: string;
  open: (host: EngineHost) => Promise<{ handle: DocumentHandle }>;
  rows: (state: unknown) => Row[];
  actions: Action[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const configs: Record<string, EditorConfig> = {
  prism: {
    title: "Prism",
    open: async (h) => {
      const d = await PrismDocument.open(h, 256, 256);
      const l = (await d.addRasterLayer("Layer 1")).data.layer_id;
      void l;
      return d;
    },
    rows: studioRows.prism,
    actions: [
      {
        id: "add-layer", title: actionTitles.prism["add-layer"],
        run: (d) => d.apply("addRasterLayer", { name: `Layer ${((d.state as any)?.layers?.length ?? 0) + 1}` }),
      },
      {
        id: "fill-blue", title: actionTitles.prism["fill-blue"],
        run: async (d) => {
          const s: any = d.state;
          const top = s?.layers?.[s.layers.length - 1];
          if (top) await d.apply("fillLayer", { id: top.id, color: [37, 99, 235, 255] });
        },
      },
      {
        id: "invert", title: actionTitles.prism["invert"],
        run: async (d) => {
          const s: any = d.state;
          const top = s?.layers?.[s.layers.length - 1];
          if (top) await d.apply("applyFilter", { id: top.id, filter: { type: "invert" } });
        },
      },
    ],
  },
  cadence: {
    title: "Cadence",
    open: async (h) => CadenceDocument.open(h),
    rows: studioRows.cadence,
    actions: [
      { id: "add-midi-track", title: actionTitles.cadence["add-midi-track"], run: (d) => d.apply("addTrack", { kind: "midi" }) },
      {
        id: "add-chord", title: actionTitles.cadence["add-chord"],
        run: async (d) => {
          const s: any = d.state;
          const t = s?.tracks?.[0];
          if (!t) return;
          const c = await d.apply("addClip", {
            track: t.id, start_ticks: 0, length_ticks: 960,
          });
          const clipId = (c.data as any).clip_id;
          for (const [i, p] of [60, 64, 67].entries())
            await d.apply("addNote", {
              clip: clipId, pitch: p, start_ticks: i * 320, length_ticks: 320,
            });
        },
      },
      { id: "tempo-140", title: actionTitles.cadence["tempo-140"], run: (d) => d.apply("setTempo", { bpm: 140 }) },
    ],
  },
  splice: {
    title: "Splice",
    open: async (h) => SpliceDocument.open(h),
    rows: studioRows.splice,
    actions: [
      {
        id: "add-clip", title: actionTitles.splice["add-clip"],
        run: async (d) => {
          const src = (await d.apply("addSource", { duration_s: 30, name: "clip.mp4" }))
            .data as any;
          const tr = (await d.apply("addTrack", { kind: "video" })).data as any;
          await d.apply("addClip", {
            track: tr.track_id, source: src.source_id, in_s: 0, out_s: 8,
          });
        },
      },
      {
        id: "split-clip", title: actionTitles.splice["split-clip"],
        run: async (d) => {
          const s: any = d.state;
          const c = s?.tracks?.[0]?.clips?.[0];
          if (!c) return;
          const mid = c.timeline_start_s + (c.out_s - c.in_s) / c.speed / 2;
          await d.apply("splitClip", { id: c.id, at_s: mid });
        },
      },
    ],
  },
  folio: {
    title: "Folio",
    open: async (h) => FolioDocument.create(h, 2),
    rows: studioRows.folio,
    actions: [
      {
        id: "add-note", title: actionTitles.folio["add-note"],
        run: (d) =>
          d.apply("addAnnotation", {
            page: 0, rect: [72, 700, 220, 18], contents: "Note",
          }),
      },
      { id: "rotate-page", title: actionTitles.folio["rotate-page"], run: (d) => d.apply("rotatePage", { page: 0, degrees: 90 }) },
    ],
  },
  pitch: {
    title: "Pitch",
    open: async (h) => PitchDocument.open(h, "Demo Deck"),
    rows: studioRows.pitch,
    actions: [
      { id: "add-slide", title: actionTitles.pitch["add-slide"], run: (d) => d.apply("addSlide", { layout: "titleBody" }) },
      {
        id: "add-title", title: actionTitles.pitch["add-title"],
        run: async (d) => {
          const s: any = d.state;
          const slide = s?.slides?.[s.slides.length - 1];
          if (!slide) return;
          const o = (await d.apply("addText", {
            slide: slide.id, x: 60, y: 80, w: 500, h: 70, text: "Heading",
            font_size: 40,
          })).data as any;
          await d.apply("addAnimation", {
            slide: slide.id, object: o.object_id, kind: "fadeIn",
            start_s: 0.4, duration_s: 0.6,
          });
        },
      },
    ],
  },
  tally: {
    title: "Tally",
    open: async (h) => TallyDocument.open(h),
    rows: studioRows.tally,
    actions: [
      {
        id: "sample-sum", title: actionTitles.tally["sample-sum"],
        run: async (d) => {
          await d.apply("setCell", { addr: "A1", value: "5" });
          await d.apply("setCell", { addr: "A2", value: "7" });
          await d.apply("setCell", { addr: "A3", value: "=SUM(A1:A2)" });
        },
      },
      { id: "add-sheet", title: actionTitles.tally["add-sheet"], run: (d) => d.apply("addSheet", {}) },
    ],
  },
  quill: {
    title: "Quill",
    open: async (h) => QuillDocument.open(h),
    rows: studioRows.quill,
    actions: [
      {
        id: "add-paragraph", title: actionTitles.quill["add-paragraph"],
        run: async (d) => {
          const s: any = d.state;
          const idx = s?.blocks?.length ?? 0;
          await d.apply("insertBlock", { index: idx, kind: "para" });
          await d.apply("insertText", {
            at: { block: idx, offset: 0 }, text: "New paragraph.",
          });
        },
      },
      {
        id: "bold-first", title: actionTitles.quill["bold-first"],
        run: async (d) => {
          const s: any = d.state;
          const len = (s?.blocks?.[0]?.inlines ?? []).reduce(
            (n: number, x: any) => n + String(x.text).length, 0,
          );
          if (len > 0)
            await d.apply("applyStyle", {
              from: { block: 0, offset: 0 },
              to: { block: 0, offset: len },
              style: { bold: true },
            });
        },
      },
    ],
  },
  photo: {
    title: "Photo",
    open: async (h) => PhotoDocument.open(h),
    rows: studioRows.photo,
    actions: [
      {
        id: "add-photo", title: actionTitles.photo["add-photo"],
        run: (d) =>
          d.apply("addOriginal", {
            sha256: "e".repeat(64),
            asset_ref: "retained:app-raw",
            byte_length: 2048,
            camera_make: "Canon",
            camera_model: "EOS R5",
          }),
      },
      {
        id: "rate-first", title: actionTitles.photo["rate-first"],
        run: async (d) => {
          const id = Object.keys((d.state as any)?.originals ?? {})[0];
          if (id) await d.apply("setRating", { id, rating: 4 });
        },
      },
      {
        id: "new-edit", title: actionTitles.photo["new-edit"],
        run: async (d) => {
          const s = d.state as any;
          const id = Object.keys(s?.originals ?? {})[0];
          if (id) await d.apply("createVersion", { original_id: id, name: "edit" });
        },
      },
    ],
  },
  motion: {
    title: "Motion",
    open: async (h) =>
      MotionDocument.open(h, { width: 320, height: 180, duration_s: 4 }),
    rows: studioRows.motion,
    actions: [
      {
        id: "add-square", title: actionTitles.motion["add-square"],
        run: async (d) => {
          const layer = (
            await d.apply("addShapeLayer", {
              shape: { kind: "rect", x: 8, y: 8, w: 48, h: 48, fill: [36, 145, 132, 255] },
              name: "Box",
            })
          ).data as any;
          await d.apply("setPropertyKeys", {
            layer: layer.layer_id,
            property: "tx",
            keys: [
              { time: 0, value: 0, interpolation: "linear", in_handle: null, out_handle: null },
              { time: 2, value: 200, interpolation: "linear", in_handle: null, out_handle: null },
            ],
          });
        },
      },
      {
        id: "preview-frame", title: actionTitles.motion["preview-frame"],
        run: async (d) => {
          const frame = await d.apply("renderFrame", { time_s: 1 });
          void frame;
        },
      },
    ],
  },
  design: {
    title: "Design",
    open: async (h) =>
      DesignDocument.open(h, { title: "Untitled screen", width: 960, height: 540 }),
    rows: studioRows.design,
    actions: [
      {
        id: "add-card", title: actionTitles.design["add-card"],
        run: async (d) => {
          const frame = (
            await d.apply("addFrame", { parent: 1, name: "Card", x: 40, y: 40, width: 240, height: 160, fill: [255, 255, 255, 255] })
          ).data as any;
          await d.apply("addShape", {
            parent: frame.node_id, kind: "rect",
            x: 12, y: 12, width: 80, height: 40, fill: [36, 145, 132, 255],
          });
          await d.apply("addText", { parent: frame.node_id, content: "Hello", x: 12, y: 64, width: 120, height: 24 });
        },
      },
      { id: "update-layout", title: actionTitles.design["update-layout"], run: (d) => d.apply("evaluateLayout", {}) },
    ],
  },
  draft: {
    title: "Draft",
    open: async (h) => DraftDocument.open(h, "mm"),
    rows: studioRows.draft,
    actions: [
      {
        id: "draw-square", title: actionTitles.draft["draw-square"],
        run: async (d) => {
          const ids: number[] = [];
          for (const [x, y] of [[0, 0], [100, 0], [100, 100], [0, 100]] as const)
            ids.push(((await d.apply("addPoint", { x, y, locked: false })).data as any).point_id);
          for (let i = 0; i < 4; i++)
            await d.apply("addSegment", { a: ids[i], b: ids[(i + 1) % 4] });
        },
      },
      {
        id: "find-shapes", title: actionTitles.draft["find-shapes"],
        run: (d) => d.apply("findProfiles", {}),
      },
    ],
  },
};

export function getEditorConfig(product: string): EditorConfig {
  return configs[product] ?? configs["prism"]!;
}
