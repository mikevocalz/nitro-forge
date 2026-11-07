import type { BlockKind, Pos, QuillDocument, Style } from "./index";

/**
 * Engine side of NYC-Tron's document controls (Forge roster H-03
 * RichTextRibbon, H-07 BulletsNumberingEditor, H-15 NavigationOutline, H-21
 * DocumentReadAloudTransport). No React and no `@nyc-tron/*` import: plain
 * data and callbacks named after the NYC-Tron props.
 *
 * Callbacks exist only for operations the Rust Quill engine has; the rest are
 * listed in {@link QUILL_DEFERRED_OPS} and their controls are not drawn.
 * Writes go to the engine first and the binding is re-read afterwards.
 */

/**
 * Engine operations the document controls can express but Quill does not
 * have. Each is a DEFER: the matching NYC-Tron prop is left out.
 */
export const QUILL_DEFERRED_OPS = {
  /** H-03 highlighter (a run background color). */
  setHighlight: "H-03",
  /**
   * H-03 change case. Doing it as `deleteRange` + `insertText` would drop the
   * runs' styles, so it waits for an engine op that rewrites text in place.
   */
  changeCase: "H-03",
  /**
   * H-07 numbering definitions (bullet vs number, per-level format). Quill's
   * `list` block exports as Word's ListParagraph style without numPr, so no
   * marker is stored.
   */
  setListFormat: "H-07",
  /** H-07 nesting: Quill blocks have no list level. */
  setListLevel: "H-07",
  /** H-15 bookmarks: Quill has no named positions. */
  bookmarks: "H-15",
  /** H-15 page thumbnails: `layout` gives line spans, not pixels. */
  renderPage: "H-15",
} as const;
export type QuillDeferredOp = keyof typeof QUILL_DEFERRED_OPS;

/** A run of text with one style, as `blocks` reports it. */
export interface QuillRun {
  readonly text: string;
  readonly style: Style;
}

/** A block as `blocks` reports it, with its plain text joined. */
export interface QuillBlock {
  readonly index: number;
  readonly kind: BlockKind;
  readonly text: string;
  readonly runs: readonly QuillRun[];
}

/** A selection in Quill positions; `end` is exclusive. */
export interface QuillSelection {
  readonly start: Pos;
  readonly end: Pos;
}

export type QuillOfficeDocument = Pick<QuillDocument, "blocks" | "applyStyle" | "setBlockKind" | "layout">;

const KINDS = new Set<BlockKind>(["para", "h1", "h2", "h3", "list", "quote"]);

function requireData<T>(response: { data?: T }, op: string): T {
  if (response.data === undefined || response.data === null) throw new Error(`Quill ${op} returned no data`);
  return response.data;
}

/** Reads every block through `blocks`. */
export async function readQuillBlocks(document: Pick<QuillDocument, "blocks">): Promise<QuillBlock[]> {
  const data = requireData(await document.blocks<{ blocks: { kind: BlockKind; inlines: QuillRun[] }[] }>(), "blocks");
  if (!Array.isArray(data.blocks)) throw new Error("Quill returned invalid blocks");
  return data.blocks.map((b, index) => {
    if (!KINDS.has(b.kind) || !Array.isArray(b.inlines)) throw new Error(`Quill returned a malformed block ${index}`);
    return { index, kind: b.kind, runs: b.inlines, text: b.inlines.map(r => r.text).join("") };
  });
}

const chars = (s: string) => [...s].length;

/**
 * Styles of the runs a selection covers, for NYC-Tron's `ribbonStateFor`.
 * A collapsed selection reports the run before the caret (the style typing
 * would continue), as editors do.
 */
export function quillSelectionRuns(blocks: readonly QuillBlock[], sel: QuillSelection): Style[] {
  const { start, end } = sel;
  if (start.block > end.block || (start.block === end.block && start.offset > end.offset)) throw new RangeError("Selection end is before its start");
  const out: Style[] = [];
  const collapsed = start.block === end.block && start.offset === end.offset;
  for (let b = start.block; b <= end.block; b++) {
    const block = blocks[b];
    if (!block) throw new RangeError(`No block ${b}`);
    const from = b === start.block ? start.offset : 0;
    const to = b === end.block ? end.offset : chars(block.text);
    let pos = 0;
    for (const run of block.runs) {
      const len = chars(run.text);
      const a = pos, z = pos + len;
      pos = z;
      if (collapsed ? (from > a && from <= z) || (from === 0 && a === 0) : z > from && a < to) out.push(run.style);
      if (collapsed && out.length) return out;
    }
  }
  return out;
}

/** Paragraph styles the ribbon offers, in Quill block kinds. List lives in the list editor. */
export const QUILL_PARAGRAPH_STYLES = [
  { id: "para", label: "Normal" }, { id: "h1", label: "Heading 1" }, { id: "h2", label: "Heading 2" },
  { id: "h3", label: "Heading 3" }, { id: "quote", label: "Quote" },
] as const satisfies readonly { id: BlockKind; label: string }[];

/** Character toggles `applyStyle` stores. */
export type QuillToggle = "bold" | "italic" | "underline" | "strike";

/** `RichTextRibbon` props Quill can back. Highlight and case are deferred. */
export interface QuillRibbonBinding {
  readonly runs: readonly Style[];
  /** The selection's paragraph kind, or "mixed". */
  readonly paragraphStyle: BlockKind | "mixed";
  readonly paragraphStyles: typeof QUILL_PARAGRAPH_STYLES;
  readonly onToggle: (toggle: QuillToggle, on: boolean) => Promise<void>;
  /** Undefined inherits document defaults; mixed selections remain explicit. */
  readonly fontFamily: string | "mixed" | undefined;
  readonly fontSize: number | "mixed" | undefined;
  readonly onFontSizeChange: (size: number | undefined) => Promise<void>;
  readonly onFontFamilyChange: (family: string | undefined) => Promise<void>;
  /** `undefined` clears the color (Quill takes `null`). */
  readonly onColorChange: (color: string | undefined) => Promise<void>;
  readonly onParagraphStyleChange: (id: string) => Promise<void>;
}

/** Binds the ribbon to a selection. A collapsed selection has nothing to style, so toggles reject. */
export async function bindQuillRibbon(
  document: QuillOfficeDocument, sel: QuillSelection, onChanged: (next: QuillRibbonBinding) => void,
): Promise<QuillRibbonBinding> {
  const blocks = await readQuillBlocks(document);
  const runs = quillSelectionRuns(blocks, sel);
  const kinds = new Set(blocks.slice(sel.start.block, sel.end.block + 1).map(b => b.kind));
  const after = async (write: () => Promise<unknown>) => {
    await write();
    onChanged(await bindQuillRibbon(document, sel, onChanged));
  };
  const collapsed = sel.start.block === sel.end.block && sel.start.offset === sel.end.offset;
  const style = (s: Style) => after(() => {
    if (collapsed) throw new RangeError("Select text to change its style");
    return document.applyStyle(sel.start, sel.end, s);
  });
  return {
    runs,
    paragraphStyle: kinds.size === 1 ? [...kinds][0]! : "mixed",
    paragraphStyles: QUILL_PARAGRAPH_STYLES,
    onToggle: (t, on) => style({ [t]: on }),
    fontFamily: runs.length && runs.every(run => run.font_family === runs[0]!.font_family) ? runs[0]!.font_family ?? undefined : runs.length ? "mixed" : undefined,
    fontSize: runs.length && runs.every(run => run.font_size === runs[0]!.font_size) ? runs[0]!.font_size ?? undefined : runs.length ? "mixed" : undefined,
    onFontSizeChange: size => style({ font_size: size ?? null }),
    onFontFamilyChange: family => style({ font_family: family ?? null }),
    onColorChange: color => style({ color: (color ?? null) as unknown as string }),
    onParagraphStyleChange: id => after(async () => {
      if (!QUILL_PARAGRAPH_STYLES.some(p => p.id === id)) throw new RangeError(`"${id}" is not a Quill paragraph style`);
      for (let b = sel.start.block; b <= sel.end.block; b++) await document.setBlockKind(b, id as BlockKind);
    }),
  };
}

/** `BulletsNumberingEditor` props Quill can back: list on or off. Formats and levels are deferred. */
export interface QuillListBinding {
  /** The selected blocks as list items (every level is 0). */
  readonly items: readonly { id: string; text: string; level: 0 }[];
  readonly kind: "none" | "bullet" | "mixed";
  /** Quill stores "a list paragraph" only, offered as the bulleted kind. */
  readonly kinds: readonly ["none", "bullet"];
  readonly onKindChange: (kind: string) => Promise<void>;
}

/** Binds the list editor to blocks `[first, last]`. */
export async function bindQuillList(
  document: QuillOfficeDocument, first: number, last: number, onChanged: (next: QuillListBinding) => void,
): Promise<QuillListBinding> {
  const blocks = await readQuillBlocks(document);
  if (first < 0 || last < first || last >= blocks.length) throw new RangeError("Block range is out of the document");
  const chosen = blocks.slice(first, last + 1);
  const lists = chosen.filter(b => b.kind === "list").length;
  const after = async (write: () => Promise<unknown>) => {
    await write();
    onChanged(await bindQuillList(document, first, last, onChanged));
  };
  return {
    items: chosen.map(b => ({ id: String(b.index), text: b.text, level: 0 as const })),
    kind: lists === 0 ? "none" : lists === chosen.length ? "bullet" : "mixed",
    kinds: ["none", "bullet"],
    onKindChange: kind => after(async () => {
      if (kind !== "none" && kind !== "bullet") throw new RangeError(`Quill cannot store a "${kind}" list (see QUILL_DEFERRED_OPS.setListFormat)`);
      for (const b of chosen) await document.setBlockKind(b.index, kind === "none" ? "para" : "list");
    }),
  };
}

/** A heading as NYC-Tron `OutlineHeading` takes it. */
export interface QuillOutlineHeading {
  readonly id: string;
  readonly level: 1 | 2 | 3;
  readonly text: string;
  readonly block: number;
  readonly page?: number;
}

/**
 * Headings (h1–h3) with the page each starts on, from `layout` at the given
 * page width and font size, plus the page count. Pass the same metrics the
 * editor lays out with so page numbers agree.
 */
export async function readQuillOutline(
  document: QuillOfficeDocument, pageWidth: number, fontSize: number, pageHeight?: number,
): Promise<{ headings: QuillOutlineHeading[]; pageCount: number }> {
  const blocks = await readQuillBlocks(document);
  const pages = requireData(await document.layout(pageWidth, fontSize, pageHeight), "layout").pages;
  const firstPage = new Map<number, number>();
  pages.forEach((p, i) => p.lines.forEach(l => { if (!firstPage.has(l.block)) firstPage.set(l.block, i); }));
  const headings = blocks.flatMap(b => b.kind === "h1" || b.kind === "h2" || b.kind === "h3"
    ? [{ id: "b" + b.index, level: Number(b.kind[1]) as 1 | 2 | 3, text: b.text, block: b.index,
        ...(firstPage.has(b.index) ? { page: firstPage.get(b.index)! } : {}) }]
    : []);
  return { headings, pageCount: pages.length };
}

/** Blocks as read-aloud input (`readAloudSentences` takes `{block, text}`), skipping empty ones. */
export async function readQuillReadAloudBlocks(document: Pick<QuillDocument, "blocks">): Promise<{ block: number; text: string }[]> {
  return (await readQuillBlocks(document)).filter(b => b.text.trim()).map(b => ({ block: b.index, text: b.text }));
}

/** For `describeBlock`: the nearest heading at or above `block`, as text. */
export function quillSectionOf(headings: readonly QuillOutlineHeading[], block: number): string | undefined {
  let found: string | undefined;
  for (const h of headings) { if (h.block > block) break; found = h.text; }
  return found;
}
