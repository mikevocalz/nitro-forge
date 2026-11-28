/**
 * What each studio's sample editor shows people: the outline rows and the
 * Actions panel labels. Kept apart from editors.tsx, which opens the engines,
 * so the wording is tested without them (editor-copy.test.ts).
 *
 * Rules: count from 1, name the action in plain words, no engine op names,
 * payload syntax or ids.
 */
export interface Row {
  label: string;
  value: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = (o: any, k: string, d: any = undefined) =>
  o && typeof o === "object" ? o[k] ?? d : d;

/** "1 clip", "2 clips". */
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const capital = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const percent = (value: unknown) => `${Math.round(Number(value ?? 1) * 100)}%`;
const named = (name: unknown, fallback: string) =>
  typeof name === "string" && name.trim() ? name : fallback;
const count = (value: unknown) => Object.keys(value ?? {}).length;

/** Labels for the Actions panel, by studio and stable action id (also its testID). */
export const actionTitles = {
  prism: { "add-layer": "Add layer", "fill-blue": "Fill top layer with blue", invert: "Invert top layer colors" },
  cadence: { "add-midi-track": "Add MIDI track", "add-chord": "Add C major chord to first track", "tempo-140": "Set tempo to 140 BPM" },
  splice: { "add-clip": "Add an 8-second sample clip", "split-clip": "Split first clip in half" },
  folio: { "add-note": "Add a note to page 1", "rotate-page": "Rotate page 1 by 90°" },
  pitch: { "add-slide": "Add slide", "add-title": "Add a fading title to the last slide" },
  tally: { "sample-sum": "Add sample numbers and a total", "add-sheet": "Add sheet" },
  quill: { "add-paragraph": "Add paragraph", "bold-first": "Make the first paragraph bold" },
  photo: { "add-photo": "Add a sample photo", "rate-first": "Rate the first photo 4 stars", "new-edit": "Start a new edit of the first photo" },
  motion: { "add-square": "Add a moving square", "preview-frame": "Preview the frame at 1 second" },
  design: { "add-card": "Add a sample card", "update-layout": "Update layout" },
  draft: { "draw-square": "Draw a 100 mm square", "find-shapes": "Find closed shapes" },
} as const;

export const studioRows: Record<keyof typeof actionTitles, (s: any) => Row[]> = {
  prism: (s) => [
    { label: "Canvas", value: `${s?.width ?? 0} × ${s?.height ?? 0} px` },
    ...(s?.layers ?? []).map((l: any, i: number) => ({
      label: named(l.name, `Layer ${i + 1}`),
      value: `Opacity ${percent(l.opacity)}${l.visible ? "" : " · Hidden"}`,
    })),
  ],
  cadence: (s) => [
    { label: "Tempo", value: `${s?.tempo_bpm ?? "?"} BPM` },
    { label: "Time signature", value: (s?.time_sig ?? []).join("/") },
    ...(s?.tracks ?? []).map((t: any, i: number) => ({
      label: named(t.name, `Track ${i + 1}`),
      value: `${plural(t.clips?.length ?? 0, "clip")}${t.muted ? " · Muted" : ""}`,
    })),
  ],
  splice: (s) => [
    { label: "Frame rate", value: `${s?.fps ?? 30} fps` },
    ...(s?.tracks ?? []).map((t: any, i: number) => ({
      label: `${capital(String(t.kind ?? "media"))} track ${i + 1}`,
      value: plural(t.clips?.length ?? 0, "clip"),
    })),
  ],
  folio: (s) => [{ label: "Pages", value: String(s?.pages ?? "?") }],
  pitch: (s) => [
    { label: "Title", value: g(s?.meta, "title", "—") },
    { label: "Slides", value: String(s?.slides?.length ?? 0) },
  ],
  tally: (s) =>
    (s?.sheets ?? []).map((sh: any, i: number) => ({
      label: named(sh.name, `Sheet ${i + 1}`),
      value: plural(count(sh.cells), "filled cell"),
    })),
  quill: (s) =>
    (s?.blocks ?? []).map((b: any, i: number) => ({
      label: `${b.kind === "h1" || b.kind === "h2" ? "Heading" : b.kind === "quote" ? "Quote" : "Paragraph"} ${i + 1}`,
      value: (b.inlines ?? []).map((x: any) => x.text).join(""),
    })),
  photo: (s) => [
    { label: "Photos", value: String(count(s?.originals)) },
    { label: "Edits", value: String(count(s?.versions)) },
    ...(Object.values(s?.originals ?? {}) as any[]).map((o: any) => ({
      label: `${o.camera_make ?? "Camera"} ${o.camera_model ?? ""}`.trim(),
      value: `${plural(o.rating ?? 0, "star")} · ${plural((o.labels ?? []).length, "label")}`,
    })),
  ],
  motion: (s) => {
    const rate = s?.frame_rate?.num && s?.frame_rate?.den ? Math.round((s.frame_rate.num / s.frame_rate.den) * 100) / 100 : "?";
    return [
      { label: "Canvas", value: `${s?.width ?? 0} × ${s?.height ?? 0} px` },
      { label: "Duration", value: `${s?.duration_s ?? "?"} s at ${rate} fps` },
      ...(s?.layers ?? []).map((l: any, i: number) => ({
        label: named(l.name, `Layer ${i + 1}`),
        value: `${capital(String(l.kind ?? "layer"))} · Opacity ${percent(l.opacity)}${l.visible === false ? " · Hidden" : ""}`,
      })),
    ];
  },
  design: (s) => [
    { label: "Title", value: g(s, "title", "—") },
    { label: "Elements", value: String(count(s?.nodes)) },
  ],
  draft: (s) => [
    { label: "Units", value: String(s?.units ?? "mm") },
    { label: "Geometry", value: `${plural(count(s?.points), "point")} · ${plural(count(s?.segments), "line")} · ${plural(count(s?.circles), "circle")}` },
    { label: "Constraints", value: String(count(s?.constraints)) },
  ],
};
