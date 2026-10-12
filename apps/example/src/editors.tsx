import type { EngineHost } from "@nitro-forge/ignition";
import { PrismDocument } from "@nitro-forge/prism";
import { CadenceDocument } from "@nitro-forge/cadence";
import { SpliceDocument } from "@nitro-forge/splice";
import { FolioDocument } from "@nitro-forge/folio";
import { PitchDocument } from "@nitro-forge/pitch";
import { TallyDocument } from "@nitro-forge/tally";
import { QuillDocument } from "@nitro-forge/quill";
import type { EditorDoc } from "./useDocument";

export interface Row {
  label: string;
  value: string;
}
export interface Action {
  title: string;
  run: (doc: EditorDoc) => Promise<unknown> | unknown;
}
export interface EditorConfig {
  title: string;
  open: (host: EngineHost) => Promise<{ handle: unknown }>;
  rows: (state: unknown) => Row[];
  actions: Action[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = (o: any, k: string, d: any = undefined) =>
  o && typeof o === "object" ? o[k] ?? d : d;

const configs: Record<string, EditorConfig> = {
  prism: {
    title: "Prism",
    open: async (h) => {
      const d = await PrismDocument.open(h, 256, 256);
      const l = (await d.addRasterLayer("Layer 1")).data.layer_id;
      void l;
      return d as unknown as { handle: unknown };
    },
    rows: (s: any) => [
      { label: "Canvas", value: `${s?.width ?? 0} × ${s?.height ?? 0}` },
      ...(s?.layers ?? []).map((l: any, i: number) => ({
        label: `Layer ${i}: ${l.name}`,
        value: `opacity ${l.opacity}${l.visible ? "" : " (hidden)"}`,
      })),
    ],
    actions: [
      {
        title: "Add raster layer",
        run: (d) => d.apply("addRasterLayer", { name: `Layer ${Date.now() % 1000}` }),
      },
      {
        title: "Fill top layer blue",
        run: async (d) => {
          const s: any = d.state;
          const top = s?.layers?.[s.layers.length - 1];
          if (top) await d.apply("fillLayer", { id: top.id, color: [37, 99, 235, 255] });
        },
      },
      {
        title: "Invert top layer",
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
    open: async (h) => CadenceDocument.open(h) as unknown as { handle: unknown },
    rows: (s: any) => [
      { label: "Tempo", value: `${s?.tempo_bpm ?? "?"} BPM` },
      { label: "Signature", value: (s?.time_sig ?? []).join("/") },
      ...(s?.tracks ?? []).map((t: any, i: number) => ({
        label: `Track ${i}: ${t.name}`,
        value: `${t.clips?.length ?? 0} clips${t.muted ? " · muted" : ""}`,
      })),
    ],
    actions: [
      { title: "Add MIDI track", run: (d) => d.apply("addTrack", { kind: "midi" }) },
      {
        title: "Add C-major clip to first track",
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
      { title: "Tempo → 140", run: (d) => d.apply("setTempo", { bpm: 140 }) },
    ],
  },
  splice: {
    title: "Splice",
    open: async (h) => SpliceDocument.open(h) as unknown as { handle: unknown },
    rows: (s: any) => [
      { label: "FPS", value: String(s?.fps ?? 30) },
      ...(s?.tracks ?? []).map((t: any, i: number) => ({
        label: `${t.kind} track ${i}`,
        value: `${t.clips?.length ?? 0} clips`,
      })),
    ],
    actions: [
      {
        title: "Add source + video track + 8s clip",
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
        title: "Split first clip at midpoint",
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
    open: async (h) => FolioDocument.create(h, 2) as unknown as { handle: unknown },
    rows: (s: any) => [{ label: "Pages", value: String(s?.pages ?? "?") }],
    actions: [
      {
        title: "Annotate page 1",
        run: (d) =>
          d.apply("addAnnotation", {
            page: 0, rect: [72, 700, 220, 18], contents: "Added from app",
          }),
      },
      { title: "Rotate page 1 → 90°", run: (d) => d.apply("rotatePage", { page: 0, degrees: 90 }) },
    ],
  },
  pitch: {
    title: "Pitch",
    open: async (h) => PitchDocument.open(h, "Demo Deck") as unknown as { handle: unknown },
    rows: (s: any) => [
      { label: "Title", value: g(s?.meta, "title", "—") },
      { label: "Slides", value: String(s?.slides?.length ?? 0) },
    ],
    actions: [
      { title: "Add slide", run: (d) => d.apply("addSlide", { layout: "titleBody" }) },
      {
        title: "Add animated title text",
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
    open: async (h) => TallyDocument.open(h) as unknown as { handle: unknown },
    rows: (s: any) =>
      (s?.sheets ?? []).map((sh: any, i: number) => ({
        label: `Sheet ${i}: ${sh.name}`,
        value: `${Object.keys(sh.cells ?? {}).length} cells`,
      })),
    actions: [
      {
        title: "Write A1=5, A2=7, A3=SUM",
        run: async (d) => {
          await d.apply("setCell", { addr: "A1", value: "5" });
          await d.apply("setCell", { addr: "A2", value: "7" });
          await d.apply("setCell", { addr: "A3", value: "=SUM(A1:A2)" });
        },
      },
      { title: "Add sheet", run: (d) => d.apply("addSheet", {}) },
    ],
  },
  quill: {
    title: "Quill",
    open: async (h) => QuillDocument.open(h) as unknown as { handle: unknown },
    rows: (s: any) =>
      (s?.blocks ?? []).map((b: any, i: number) => ({
        label: `¶${i} (${b.kind})`,
        value: (b.inlines ?? []).map((x: any) => x.text).join(""),
      })),
    actions: [
      {
        title: "Append paragraph",
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
        title: "Bold first block",
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
};

export function getEditorConfig(product: string): EditorConfig {
  return configs[product] ?? configs["prism"]!;
}
