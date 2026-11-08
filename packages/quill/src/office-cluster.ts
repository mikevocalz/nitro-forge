import type { BlockKind, Bookmark, Pos, QuillDocument, Style, ListItem, ListFormat, ListKind, TextCase } from "./index";
import {deriveQuillListMarkers} from './list-markers';
export {deriveQuillListMarkers} from './list-markers';

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
  // H-15 `renderPage` lifted for R1 (engine op + TS adapter shipped);
  // full NavigationOutline thumbnail composition remains R3 scope.
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
  readonly list?:ListItem;
  readonly text: string;
  readonly runs: readonly QuillRun[];
}

/** A selection in Quill positions; `end` is exclusive. */
export interface QuillSelection {
  readonly start: Pos;
  readonly end: Pos;
}

export type QuillOfficeDocument = Pick<QuillDocument, "blocks" | "applyStyle" | "changeCase" | "setBlockKind" | "setListKind" | "setListFormat" | "shiftListLevel" | "layout">;

const KINDS = new Set<BlockKind>(["para", "h1", "h2", "h3", "list", "quote"]);

function requireData<T>(response: { data?: T }, op: string): T {
  if (response.data === undefined || response.data === null) throw new Error(`Quill ${op} returned no data`);
  return response.data;
}

/** Reads every block through `blocks`. */
export async function readQuillBlocks(document: Pick<QuillDocument, "blocks">): Promise<QuillBlock[]> {
  const data = requireData(await document.blocks<{ blocks: { kind: BlockKind; list?:ListItem; inlines: QuillRun[] }[] }>(), "blocks");
  if (!Array.isArray(data.blocks)) throw new Error("Quill returned invalid blocks");
  return data.blocks.map((b, index) => {
    if (!KINDS.has(b.kind) || !Array.isArray(b.inlines)) throw new Error(`Quill returned a malformed block ${index}`);
    return { index, kind: b.kind,...(b.list?{list:b.list}:{}), runs: b.inlines, text: b.inlines.map(r => r.text).join("") };
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

/** `RichTextRibbon` props backed by persistent Quill style and case operations. */
export interface QuillRibbonBinding {
  /** Host selection metadata; synchronize the actual range after case expansions. */
  readonly selection: QuillSelection;
  readonly runs: readonly Style[];
  /** The selection's paragraph kind, or "mixed". */
  readonly paragraphStyle: BlockKind | "mixed";
  readonly paragraphStyles: typeof QUILL_PARAGRAPH_STYLES;
  readonly onChangeCase: (mode: TextCase) => Promise<void>;
  readonly onToggle: (toggle: QuillToggle, on: boolean) => Promise<void>;
  /** Undefined inherits document defaults; mixed selections remain explicit. */
  readonly fontFamily: string | "mixed" | undefined;
  readonly fontSize: number | "mixed" | undefined;
  readonly highlight: string | "mixed" | undefined;
  readonly onHighlightChange: (color: string | undefined) => Promise<void>;
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
    selection: sel,
    paragraphStyle: kinds.size === 1 ? [...kinds][0]! : "mixed",
    paragraphStyles: QUILL_PARAGRAPH_STYLES,
    onChangeCase: async mode => {
      if (collapsed) throw new RangeError("Select text to change its case");
      const range = requireData(await document.changeCase(sel.start, sel.end, mode), "changeCase");
      onChanged(await bindQuillRibbon(document, { start: range.from, end: range.to }, onChanged));
    },
    onToggle: (t, on) => style({ [t]: on }),
    fontFamily: runs.length && runs.every(run => run.font_family === runs[0]!.font_family) ? runs[0]!.font_family ?? undefined : runs.length ? "mixed" : undefined,
    fontSize: runs.length && runs.every(run => run.font_size === runs[0]!.font_size) ? runs[0]!.font_size ?? undefined : runs.length ? "mixed" : undefined,
    highlight: runs.length && runs.every(run => run.highlight === runs[0]!.highlight) ? runs[0]!.highlight ?? undefined : runs.length ? "mixed" : undefined,
    onHighlightChange: color => style({ highlight: color ?? null }),
    onFontSizeChange: size => style({ font_size: size ?? null }),
    onFontFamilyChange: family => style({ font_family: family ?? null }),
    onColorChange: color => style({ color: (color ?? null) as unknown as string }),
    onParagraphStyleChange: id => after(async () => {
      if (!QUILL_PARAGRAPH_STYLES.some(p => p.id === id)) throw new RangeError(`"${id}" is not a Quill paragraph style`);
      for (let b = sel.start.block; b <= sel.end.block; b++) await document.setBlockKind(b, id as BlockKind);
    }),
  };
}

/** Actual source capability from the linked H-07 module; absent/unknown versions keep the old gate. */
export interface QuillListHostCapabilities {readonly version:number;readonly authoritativeMarkers?:boolean}
/** Without authoritative marker support the preview needs one context and default starts. */
export interface QuillListBinding {
 readonly items:readonly {id:string;text:string;level:number;marker?:string}[];
 readonly selectionStart:number;readonly selectionEnd:number;
 readonly kind:ListKind|"mixed";readonly kinds:readonly ListKind[];
 readonly levelFormats?:readonly ListFormat[];
 readonly onKindChange:(kind:ListKind)=>Promise<void>;
 readonly onLevelFormatChange?:(level:number,format:ListFormat)=>Promise<void>;
 readonly onShiftLevel?:(direction:1|-1)=>Promise<void>;
}
export async function bindQuillList(document:QuillOfficeDocument,first:number,last:number,onChanged:(next:QuillListBinding)=>void,capabilities?:QuillListHostCapabilities):Promise<QuillListBinding>{
 const blocks=await readQuillBlocks(document);
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||last<first||last>=blocks.length)throw new RangeError("Block range is out of the document");
 const authoritative=capabilities?.version===1&&capabilities.authoritativeMarkers===true;
 const markers=authoritative?deriveQuillListMarkers(blocks):undefined;
 const chosen=blocks.slice(first,last+1),lists=chosen.filter(b=>b.kind==='list');
 let context=chosen,kind:ListKind|"mixed"='none',formats:ListFormat[]|undefined;
 if(lists.length){
  const list=chosen[0]!.list;
  const coherent=lists.length===chosen.length&&(list?chosen.every(b=>b.list?.definition.id===list.definition.id):chosen.every(b=>!b.list));
  if(!coherent){
   if(!authoritative)throw new Error(lists.length!==chosen.length?'Canonical list preview cannot represent mixed list/nonlist paragraphs':'Canonical list preview needs one list definition');
   const kinds=new Set(chosen.map(b=>b.kind==='list'?(b.list?.definition.kind??'bullet'):'none'));
   kind=kinds.size===1?[...kinds][0]!:'mixed';
  }else if(list){
   context=blocks.filter(b=>b.kind==='list'&&b.list?.definition.id===list.definition.id);
   if(list.definition.levels.length!==9||!authoritative&&context.some(b=>list.definition.levels[b.list!.level]?.start!==1))throw new Error('Canonical list preview cannot represent nondefault numbering starts');
   kind=list.definition.kind;formats=list.definition.levels.map(l=>l.format);
  }else{
   let start=first,end=last;while(start>0&&blocks[start-1]!.kind==='list'&&!blocks[start-1]!.list)start--;while(end+1<blocks.length&&blocks[end+1]!.kind==='list'&&!blocks[end+1]!.list)end++;
   context=blocks.slice(start,end+1);kind='bullet';formats=Array<ListFormat>(9).fill('bullet');
  }
 }

 const after=async(write:()=>Promise<unknown>)=>{await write();onChanged(await bindQuillList(document,first,last,onChanged,capabilities));};
 return {items:context.map(b=>({id:String(b.index),text:b.text,level:b.list?.level??0,...(markers?{marker:markers[b.index]!}:{})})),selectionStart:context.findIndex(b=>b.index===first),selectionEnd:context.findIndex(b=>b.index===last),kind,kinds:['none','bullet','numbered','multilevel'],
  onKindChange:kind=>after(()=>document.setListKind(first,last,kind)),
  ...(formats?{levelFormats:formats,onLevelFormatChange:(level:number,format:ListFormat)=>after(()=>document.setListFormat(first,last,level,format)),onShiftLevel:(direction:1|-1)=>after(()=>document.shiftListLevel(first,last,direction))}:{})};
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

/** A named position as `listBookmarks` reports it. */
export type QuillBookmark = Bookmark;

/** Reads every bookmark through `listBookmarks` (already position-sorted). */
export async function readQuillBookmarks(
  document: Pick<QuillDocument, "listBookmarks">,
): Promise<QuillBookmark[]> {
  const data = requireData(await document.listBookmarks(), "listBookmarks");
  if (!Array.isArray(data.bookmarks)) throw new Error("Quill returned invalid bookmarks");
  return data.bookmarks.map(b => {
    if (typeof b.name !== "string" || typeof b.pos?.block !== "number" || typeof b.pos?.offset !== "number") {
      throw new Error("Quill returned a malformed bookmark");
    }
    return { name: b.name, pos: { block: b.pos.block, offset: b.pos.offset } };
  });
}

/**
 * The Bookmarks view props of NYC-Tron's `NavigationOutline` (H-15), backed
 * by the real `addBookmark`/`removeBookmark`/`listBookmarks` ops. `id` is
 * the unique bookmark name. `onJump` receives the bookmark's current `Pos`
 * so the host can move the caret; bookmark positions are re-read on every
 * jump because edits re-anchor them.
 */
export interface QuillBookmarkBinding {
  readonly bookmarks: readonly { id: string; name: string }[];
  readonly onJumpToBookmark: (bookmark: { id: string; name: string }) => Promise<void>;
  readonly addBookmark: (name: string, pos: Pos) => Promise<void>;
  readonly removeBookmark: (name: string) => Promise<void>;
}

export async function bindQuillBookmarks(
  document: Pick<QuillDocument, "listBookmarks" | "addBookmark" | "removeBookmarkByName">,
  onJump: (pos: Pos) => void,
  onChanged?: (next: QuillBookmarkBinding) => void,
): Promise<QuillBookmarkBinding> {
  const read = async () => {
    const bookmarks = await readQuillBookmarks(document);
    const rebind = async () => { if (onChanged) onChanged(await bindQuillBookmarks(document, onJump, onChanged)); };
    return {
      bookmarks: bookmarks.map(b => ({ id: b.name, name: b.name })),
      onJumpToBookmark: async (bookmark: { id: string; name: string }) => {
        // Positions are re-anchored by edits, so resolve at jump time.
        const pos = (await readQuillBookmarks(document)).find(b => b.name === bookmark.id)?.pos;
        if (!pos) throw new Error(`Unknown bookmark "${bookmark.id}"`);
        onJump(pos);
      },
      addBookmark: async (name: string, pos: Pos) => {
        await document.addBookmark(name, pos);
        await rebind();
      },
      removeBookmark: async (name: string) => {
        await document.removeBookmarkByName(name);
        await rebind();
      },
    };
  };
  return read();
}
