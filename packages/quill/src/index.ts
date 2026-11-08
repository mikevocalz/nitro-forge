import {
  DocumentHandle,
  base64ToBytes,
  bytesToBase64,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — mirrors docs/ENGINE_OPS.md § quill. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  insertText: "insertText",
  deleteRange: "deleteRange",
  replaceRange: "replaceRange",
  applyStyle: "applyStyle",
  changeCase: "changeCase",
  setBlockKind: "setBlockKind",
  setListKind:"setListKind",setListFormat:"setListFormat",shiftListLevel:"shiftListLevel",
  insertBlock: "insertBlock",
  splitBlock: "splitBlock",
  mergeBlock: "mergeBlock",
  text: "text",
  findText: "findText",
  replaceText: "replaceText",
  addBookmark: "addBookmark",
  removeBookmark: "removeBookmark",
  listBookmarks: "listBookmarks",
  insertSection: "insertSection",
  removeSection: "removeSection",
  setPageSetup: "setPageSetup",
  setHeaderFooter: "setHeaderFooter",
  listSections: "listSections",
  defineStyle: "defineStyle",
  updateStyle: "updateStyle",
  removeStyle: "removeStyle",
  listStyles: "listStyles",
  addComment: "addComment",
  updateComment: "updateComment",
  removeComment: "removeComment",
  resolveComment: "resolveComment",
  reopenComment: "reopenComment",
  listComments: "listComments",
  addFootnote: "addFootnote",
  updateFootnote: "updateFootnote",
  removeFootnote: "removeFootnote",
  listFootnotes: "listFootnotes",
  insertToc: "insertToc",
  updateToc: "updateToc",
  refreshToc: "refreshToc",
  listToc: "listToc",
  listMergeFields: "listMergeFields",
  previewMerge: "previewMerge",
  runMerge: "runMerge",
  addSource: "addSource",
  updateSource: "updateSource",
  removeSource: "removeSource",
  listSources: "listSources",
  addCitation: "addCitation",
  updateCitation: "updateCitation",
  removeCitation: "removeCitation",
  listCitations: "listCitations",
  insertBibliography: "insertBibliography",
  updateBibliography: "updateBibliography",
  refreshBibliography: "refreshBibliography",
  listBibliography: "listBibliography",
  setTrackChanges: "setTrackChanges",
  listRevisions: "listRevisions",
  acceptRevision: "acceptRevision",
  rejectRevision: "rejectRevision",
  acceptAllRevisions: "acceptAllRevisions",
  rejectAllRevisions: "rejectAllRevisions",
  applyNamedStyle: "applyNamedStyle",
  setBlockStyle: "setBlockStyle",
  setParagraphFormat: "setParagraphFormat",
  insertTable: "insertTable",
  deleteTable: "deleteTable",
  setCellText: "setCellText",
  insertTableRow: "insertTableRow",
  deleteTableRow: "deleteTableRow",
  insertTableColumn: "insertTableColumn",
  deleteTableColumn: "deleteTableColumn",
  listTables: "listTables",
  describeTable: "describeTable",
  mergeTableCells: "mergeTableCells",
  unmergeTableCells: "unmergeTableCells",
  blocks: "blocks",
  layout: "layout",
  registerFont: "registerFont",
  removeFont: "removeFont",
  listFonts: "listFonts",
  exportDocx: "exportDocx",
  importDocx: "importDocx",
} as const;

export type TextCase = "sentence" | "lower" | "upper" | "capitalize";

export type BlockKind = "para" | "h1" | "h2" | "h3" | "list" | "quote";

export type ListKind="none"|"bullet"|"numbered"|"multilevel";
export type ListFormat="bullet"|"decimal"|"lowerLetter"|"upperLetter"|"lowerRoman"|"upperRoman";
export interface ListLevel {format:ListFormat;start:number;indent_twips:number;hanging_twips:number}
export interface ListDefinition {id:number;kind:Exclude<ListKind,"none">;levels:readonly ListLevel[]}
export interface ListItem {level:number;definition:ListDefinition}
export interface Pos {
  block: number;
  offset: number;
}
export interface Range {
  start: Pos;
  end: Pos;
}
export interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  /** Exact #RRGGBB inline background color; null clears. */
  highlight?: string | null;
  /** Direct Latin run font; null clears an explicit family. Does not install fonts. */
  font_family?: string | null;
  /** Points, 1..1638 in half-point increments; null clears an explicit size. */
  font_size?: number | null;
  link?: string;
}
export interface LayoutLine {
  block: number;
  start: number;
  end: number;
}
export interface LayoutPage {
  lines: LayoutLine[];
}
export interface FindMatch {
  from: Pos;
  to: Pos;
  text: string;
}
/**
 * A position inside a table cell, used by `findText`'s `cell_matches`.
 * `Pos` cannot address cell text (a table block's only valid offset is
 * 0), so cell matches carry their own qualifier: `block` is the table
 * block's index, `row`/`col` the grid cell, `cell_block` the paragraph
 * index within the cell's block list, and `offset` the scalar offset
 * inside that paragraph.
 */
export interface CellPos {
  block: number;
  row: number;
  col: number;
  cell_block: number;
  offset: number;
}
/** A `findText` match inside a table cell (never spans paragraphs/cells). */
export interface CellFindMatch {
  from: CellPos;
  to: CellPos;
  text: string;
}
export interface Bookmark {
  name: string;
  pos: Pos;
}
/** Named style kind: paragraph styles mark blocks, character styles format ranges. */
export type NamedStyleKind = "paragraph" | "character";
/**
 * Paragraph alignment — the DOCX `w:jc` subset.
 */
export type ParagraphAlignment = "left" | "center" | "right" | "justify";
/** Tab-stop alignment — the DOCX `w:tabs` subset minus `bar`. */
export type TabAlignment = "left" | "center" | "right" | "decimal";
/** Tab leader; absent means no leader (DOCX `none`). */
export type TabLeader = "dot" | "hyphen" | "underscore" | "heavy";
/**
 * One tab stop. `position` is in twips from the left margin
 * (0..=31680); stops in a list must be strictly increasing, at most 64.
 */
export interface TabStop {
  position: number;
  alignment: TabAlignment;
  leader?: TabLeader;
}
/**
 * Stored paragraph formatting on a block (`describe`/`blocks` payloads).
 * All fields optional; units are twips. `indent_first` is a first-line
 * indent when positive and a hanging indent when negative
 * (-31680..=31680). Storage-only — no layout consumes these yet.
 */
export interface ParagraphFormat {
  alignment?: ParagraphAlignment;
  /** Left indent, twips 0..=31680. */
  indent_left?: number;
  /** Right indent, twips 0..=31680. */
  indent_right?: number;
  /** First-line (positive) or hanging (negative) indent, twips ±31680. */
  indent_first?: number;
  /** Tab stops, strictly increasing positions, at most 64. */
  tabs?: TabStop[];
}
/**
 * Partial paragraph-format update: present keys set, `null` clears,
 * absent keys are untouched. `tabs: []` or `tabs: null` clears the stop
 * list. Shared by `setParagraphFormat` and a style's `properties.paragraph`.
 */
export type ParagraphFormatPatch = {
  [K in keyof ParagraphFormat]?: ParagraphFormat[K] | null;
};
/**
 * `Style` plus the paragraph-format patch grammar. `paragraph` is only
 * valid on `"paragraph"`-kind styles; `setBlockStyle` copies it onto the
 * block's stored format with the same snapshot semantics as inline props.
 */
export type NamedStyleProperties = Style & {
  paragraph?: ParagraphFormatPatch | null;
};
/**
 * Durable named style definition. `properties` uses the same grammar as
 * `applyStyle`'s `style` payload, plus `paragraph` on paragraph-kind
 * styles. Styles are snapshot bundles: applying one copies its properties
 * at that moment and never live-updates afterwards.
 */
export interface NamedStyle {
  id: string;
  name: string;
  kind: NamedStyleKind;
  properties: NamedStyleProperties;
}
export interface FindOptions {
  from?: Pos;
  to?: Pos;
  /** Defaults to false (case-insensitive per-scalar Unicode lowercase). */
  caseSensitive?: boolean;
}
/** One end of a comment's anchored range (same unit as `Pos`). */
export type CommentAnchor = Pos;
/**
 * A range-anchored comment. `from` is left-gravity and `to` right-gravity,
 * so typing at either boundary extends the range; a range whose text is
 * deleted collapses toward the deletion start rather than dropping.
 * Bodies are plain text (newlines allowed), at most 8192 characters;
 * authors at most 128. No threading/replies and no timestamps — the
 * engine has no clock.
 */
export interface DocComment {
  id: string;
  from: CommentAnchor;
  to: CommentAnchor;
  author: string | null;
  body: string;
  resolved: boolean;
}
/**
 * Track-changes revision kind. `ins` brackets live inserted text;
 * `del` records a deletion whose plain text is kept on the record.
 */
export type RevisionKind = "ins" | "del";
/**
 * One tracked change, anchored to live `{block,offset}` positions like
 * comments/bookmarks (re-mapped by every position-moving op).
 *
 * - `ins`: `from..to` brackets the inserted range (`from` left-gravity,
 *   `to` right-gravity). `acceptRevision` keeps the text and drops the
 *   record; `rejectRevision` deletes the marked range.
 * - `del`: `from == to` is the collapse point; `text` carries the deleted
 *   plain text (`\n`-joined). `acceptRevision` drops the record;
 *   `rejectRevision` re-inserts `text` there — plain text only, styles
 *   and paragraph kinds are not restored.
 *
 * `author`/`time` are optional attribution; `time` is caller-supplied
 * unix seconds (the engine has no clock). These are Quill revision
 * records — NOT Word `w:ins`/`w:del`/`w:revisionId` semantics, and there
 * is no DOCX interop for them.
 */
export interface Revision {
  id: string;
  kind: RevisionKind;
  from: Pos;
  to: Pos;
  author: string | null;
  time: number | null;
  /** Present only on `del` records: the deleted plain text. */
  text?: string;
}
/**
 * Footnote/endnote placement kind. `footnote` renders at page bottom,
 * `endnote` at document end; numbering is per-kind in document order.
 */
export type FootnoteKind = "footnote" | "endnote";
/**
 * A footnote/endnote: a reference mark anchored at `at` in the block
 * stream plus a plain-text `body` stored on the record (never part of the
 * block stream, so `text`/`findText`/DOCX never see it). Bodies may be
 * empty and are at most 8192 characters; at most 1024 notes per document.
 * The anchor is a right-gravity live position re-mapped by every
 * position-moving op like bookmarks; a delete covering it clamps to the
 * deletion start rather than dropping the note. `number` is resolved by
 * `listFootnotes` per kind in document order — the engine stores none.
 */
export interface Footnote {
  id: string;
  at: Pos;
  kind: FootnoteKind;
  /** 1-based number within its kind, in document order. */
  number: number;
  body: string;
}
/**
 * One cached table-of-contents entry. `level` is the heading level
 * (1=h1, 2=h2, 3=h3 — the engine's heading block kinds; named styles are
 * not heading signals), `title` the heading's plain text at last scan,
 * and `block` the heading's top-level block index (live-remapped by
 * edits). Quill has no pagination engine, so entries carry no page
 * numbers — hosts map `block` to page/offset geometry themselves.
 */
export interface TocEntry {
  level: number;
  title: string;
  block: number;
}
/**
 * A `kind:"toc"` field block's payload as reported by `blocks`/`describe`.
 * `from_level`/`to_level` are the inclusive heading-level range (1..=3);
 * `entries` is a cached scan snapshot — it goes stale on heading text
 * edits exactly like a Word field's cached result, and `listToc` is the
 * always-live read. Regenerate with `refreshToc`/`updateToc`.
 */
export interface TocField {
  from_level: number;
  to_level: number;
  entries: TocEntry[];
}
/** `listToc` result: live entries in document order plus the count. */
export interface TocListing {
  entries: TocEntry[];
  count: number;
}
/**
 * One merge field found by `listMergeFields`/`previewMerge`: the trimmed
 * `{{name}}` token name and how many times it occurs in the document.
 * Fields are plain text tokens — there is no stored field collection.
 */
export interface MergeFieldInfo {
  name: string;
  occurrences: number;
}
/** `listMergeFields` result: fields in first-appearance order plus the total token count. */
export interface MergeFieldScan {
  fields: MergeFieldInfo[];
  occurrences: number;
}
/**
 * One data-source row for mail merge: a map of merge-field name to
 * single-line string value (at most 8192 chars, no newlines; at most
 * 256 fields). Keys must already be canonical field names — the engine
 * matches them exactly and case-sensitively.
 */
export type MergeRecord = Record<string, string>;
/** `previewMerge` result for one record: merged document text plus undefined field names. */
export interface MergePreview {
  /** Index of the record in the request's `records` array. */
  index: number;
  /** The whole document's `text`-op serialization with fields substituted. */
  text: string;
  /** Document field names this record does not define (they merge as ""). */
  missing: string[];
}
/** `previewMerge` result: per-record previews plus the document field census. */
export interface MergePreviewResult extends MergeFieldScan {
  results: MergePreview[];
}
/** `runMerge` result: substituted token count plus field names merged as "". */
export interface MergeRunResult {
  ok: boolean;
  replaced: number;
  missing: string[];
}
/**
 * One bibliography source record (P12 slice 8, citations part). `author`
 * and `title` are required non-blank text (≤512 chars); every other field
 * is optional raw-string metadata the engine never parses — no DOI/URL
 * fetching, no CSL. `container` covers journal, publisher, or series.
 * At most 1024 sources per document.
 */
export interface CitationSource {
  id: string;
  author: string;
  title: string;
  year?: string;
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  note?: string;
}
/** `listSources` entry: the stored source plus its citation count. */
export interface SourceInfo extends CitationSource {
  /** How many citations reference this source. */
  cited: number;
}
/**
 * An in-text citation: a reference mark anchored at `at` naming a
 * `sources[].id`, plus an optional `locator` ("p. 42", ≤128 chars).
 * The anchor is a right-gravity live position re-mapped by every
 * position-moving op like footnote marks; a delete covering it clamps
 * to the deletion start. `number` is resolved by `listCitations` in
 * document order — the engine stores none. There is no rendered "[1]"
 * mark in the block stream.
 */
export interface Citation {
  id: string;
  at: Pos;
  source: string;
  locator?: string;
  /** 1-based number in document (anchor) order. */
  number: number;
}
/** Bibliography entry ordering on a `kind:"bibliography"` field. */
export type BibliographySort = "alpha" | "citation";
/**
 * One cached bibliography entry: `source` is the source id (unique per
 * field) and `text` the deterministic formatted line the engine produced
 * at last scan — `Author. Title. Year. Container, volume(issue), pages.
 * doi:… url:… note.`
 */
export interface BibliographyEntry {
  source: string;
  text: string;
}
/**
 * A `kind:"bibliography"` field block's payload as reported by
 * `blocks`/`describe`. `entries` is a cached scan of the cited sources —
 * it goes stale on source/citation edits exactly like a Word field's
 * cached result, and `listBibliography` is the always-live read.
 * Regenerate with `refreshBibliography`/`updateBibliography`.
 */
export interface BibliographyField {
  sort: BibliographySort;
  entries: BibliographyEntry[];
}
/** `listBibliography` result: live entries plus the count. */
export interface BibliographyListing {
  entries: BibliographyEntry[];
  count: number;
}
/** Optional per-edit attribution overriding the tracking default author. */
export interface RevisionAttribution {
  /** String sets the revision author; null records no author. */
  author?: string | null;
  /** Unix seconds; bounded to year 9999. */
  time?: number;
}
/** Paper orientation stored per section. */
export type SectionOrientation = "portrait" | "landscape";
/** How a section begins relative to the previous one. */
export type SectionStartKind = "continuous" | "next-page" | "even-page" | "odd-page";
/** Page-number numeral format stored per section. */
export type PageNumberFormat = "decimal" | "roman" | "letters";
/**
 * Page setup in points, mirroring the NYC-Tron `PageSetupPanel` contract.
 * Bounds: width/height 36..14400, margins and column gap non-negative,
 * columns 1..32, and margins plus gaps must leave a positive text area.
 * Stored only — no layout/pagination consumes it yet.
 */
export interface PageSetup {
  width: number;
  height: number;
  orientation: SectionOrientation;
  margin_top: number;
  margin_bottom: number;
  margin_left: number;
  margin_right: number;
  columns: number;
  column_gap: number;
  start: SectionStartKind;
}
/** Partial page-setup update; absent fields keep their values. */
export type PageSetupPatch = Partial<PageSetup>;
/**
 * Header/footer bodies for one section, mirroring the NYC-Tron
 * `HeaderFooterSettings` contract. Bodies are optional plain text (at most
 * 8192 characters each); null clears. `different_first`/`different_odd_even`
 * gate whether the first/even bodies apply. Inheritance/link-previous
 * resolution is left to consumers.
 */
export interface HeaderFooter {
  header?: string;
  footer?: string;
  first_header?: string;
  first_footer?: string;
  even_header?: string;
  even_footer?: string;
  different_first: boolean;
  different_odd_even: boolean;
  page_numbers: boolean;
  number_start?: number;
  number_format: PageNumberFormat;
  link_previous: boolean;
}
/** Partial header/footer update; absent fields keep their values. */
export type HeaderFooterPatch = {
  [K in
    | "header"
    | "footer"
    | "first_header"
    | "first_footer"
    | "even_header"
    | "even_footer"]?: string | null;
} & Partial<
  Pick<
    HeaderFooter,
    | "different_first"
    | "different_odd_even"
    | "page_numbers"
    | "number_format"
    | "link_previous"
  >
> & { number_start?: number | null };
/** One document section as reported by `listSections`. */
export interface SectionInfo {
  index: number;
  /** Index of the section's first block. */
  block: number;
  page: PageSetup;
  header_footer: HeaderFooter;
}
/**
 * A table block's location and dimensions as reported by `listTables`.
 * Tables are single `kind:"table"` blocks in the block stream; each cell
 * holds its own paragraph list (see `describeTable` for cell text).
 * Block payloads may therefore report `kind: "table"` even though
 * `BlockKind` does not include it — no input op can create one directly.
 * Bounds: rows 1..=64, cols 1..=26, at most 256 tables per document.
 */
export interface TableInfo {
  /** Index of the table block in the top-level block stream. */
  block: number;
  rows: number;
  cols: number;
  /**
   * Merged regions as `{row,col,rows,cols}` rectangles in grid
   * coordinates. The cell at `row`/`col` is the anchor and keeps the
   * region's content; every other cell in the rect is covered (reports
   * empty text and rejects `setCellText`). Rects never overlap and each
   * covers at least 2 cells.
   */
  merges: TableMerge[];
}
/** One merged cell region inside a table (see `TableInfo.merges`). */
export interface TableMerge {
  /** Anchor (top-left) cell row. */
  row: number;
  /** Anchor (top-left) cell column. */
  col: number;
  /** Region height in grid cells. */
  rows: number;
  /** Region width in grid cells. */
  cols: number;
}
/** `describeTable` result: dimensions plus a row-major grid of cell text. */
export interface TableDescription extends TableInfo {
  /** `cells[row][col]` is the cell's plain text (its paragraphs joined by "\n"). */
  cells: string[][];
}

export class QuillDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost): Promise<QuillDocument> {
    const doc = await DocumentHandle.openInitialized(host, "quill",
      (document) => document.apply(OPS.newDoc, {}));
    return new QuillDocument(doc);
  }

  /** Open a .docx file's bytes into a Quill document. */
  static async openDocx(
    host: EngineHost,
    docxBytes: Uint8Array,
  ): Promise<QuillDocument> {
    const doc = await DocumentHandle.openInitialized(host, "quill",
      (document) => document.apply(OPS.importDocx, { bytes_b64: bytesToBase64(docxBytes) }));
    return new QuillDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<QuillDocument> {
    const doc = await DocumentHandle.openSnapshot(host, "quill", bytes);
    return new QuillDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }
  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  insertText(at: Pos, text: string, revision?: RevisionAttribution) {
    return this.call(OPS.insertText, {
      at,
      text,
      ...(revision?.author === undefined ? {} : { author: revision.author }),
      ...(revision?.time === undefined ? {} : { time: revision.time }),
    });
  }
  deleteRange(from: Pos, to: Pos, revision?: RevisionAttribution) {
    return this.call<{ deleted_text: string }>(OPS.deleteRange, {
      from,
      to,
      ...(revision?.author === undefined ? {} : { author: revision.author }),
      ...(revision?.time === undefined ? {} : { time: revision.time }),
    });
  }
  /** Replace `from..to` with `text` as one command and one undo step. */
  replaceRange(from: Pos, to: Pos, text: string, revision?: RevisionAttribution) {
    return this.call<{ deleted_text: string }>(OPS.replaceRange, {
      from,
      to,
      text,
      ...(revision?.author === undefined ? {} : { author: revision.author }),
      ...(revision?.time === undefined ? {} : { time: revision.time }),
    });
  }
  /** Unicode default casing; preserves run styles and returns the adjusted scalar selection. */
  changeCase(from: Pos, to: Pos, mode: TextCase) {
    return this.call<{ from: Pos; to: Pos }>(OPS.changeCase, { from, to, mode });
  }
  applyStyle(from: Pos, to: Pos, style: Style) {
    return this.call(OPS.applyStyle, { from, to, style });
  }
  setListKind(first:number,last:number,kind:ListKind){return this.call<{ok:boolean}>(OPS.setListKind,{first,last,kind});}
  setListFormat(first:number,last:number,level:number,format:ListFormat,options:Partial<Pick<ListLevel,"start"|"indent_twips"|"hanging_twips">>={}){
    return this.call<{ok:boolean}>(OPS.setListFormat,{...(options.start===undefined?{}:{start:options.start}),...(options.indent_twips===undefined?{}:{indent_twips:options.indent_twips}),...(options.hanging_twips===undefined?{}:{hanging_twips:options.hanging_twips}),first,last,level,format});
  }
  shiftListLevel(first:number,last:number,direction:1|-1){return this.call<{ok:boolean}>(OPS.shiftListLevel,{first,last,direction});}
  setBlockKind(block: number, kind: BlockKind) {
    return this.call(OPS.setBlockKind, { block, kind });
  }
  insertBlock(index: number, kind: BlockKind = "para") {
    return this.call<{ block_index: number }>(OPS.insertBlock, { index, kind });
  }
  splitBlock(at: Pos) {
    return this.call<{ new_block_index: number }>(OPS.splitBlock, { at });
  }
  mergeBlock(index: number) {
    return this.call(OPS.mergeBlock, { index });
  }
  /**
   * Plain document text, `\n` between blocks. A table block contributes
   * its cell serialization: rows `\n`-joined, cells `\t`-separated, each
   * cell's paragraphs `\n`-joined (covered merge cells report "").
   */
  text(from?: Pos, to?: Pos) {
    return this.call<{ text: string }>(OPS.text, { from, to });
  }
  /**
   * Read-only search; matches never span block boundaries. Top-level
   * matches stay in `matches`/`count` (a `Pos` shape); matches inside
   * table cells are reported separately in `cell_matches`/`cell_count`
   * with cell-qualified `CellPos` endpoints, since `Pos` cannot address
   * cell text. A table's cells are searched when the block range covers
   * the table's index (same inclusive coverage `deleteRange` applies).
   */
  findText(query: string, options: FindOptions = {}) {
    return this.call<{
      matches: FindMatch[];
      count: number;
      cell_matches: CellFindMatch[];
      cell_count: number;
    }>(OPS.findText, {
      query,
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.to === undefined ? {} : { to: options.to }),
      ...(options.caseSensitive === undefined
        ? {}
        : { case_sensitive: options.caseSensitive }),
    });
  }
  /**
   * Replace every non-overlapping match in range as one undo step.
   * Covers table cells too: in-cell matches rewrite the cell's paragraph
   * inlines (merge-covered cells are always empty, so they never match)
   * and `replaced` counts top-level plus in-cell edits.
   */
  replaceText(query: string, replacement: string, options: FindOptions = {}) {
    return this.call<{ replaced: number }>(OPS.replaceText, {
      query,
      replacement,
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.to === undefined ? {} : { to: options.to }),
      ...(options.caseSensitive === undefined
        ? {}
        : { case_sensitive: options.caseSensitive }),
    });
  }
  /**
   * Named zero-width mark at `pos`. Names are unique, 1–64 non-blank
   * non-control characters. Bookmarks have right gravity: edits shift them
   * deterministically (see docs/ENGINE_OPS.md); a bookmark whose block is
   * deleted inside a range is removed, edge blocks clamp.
   */
  addBookmark(name: string, pos: Pos) {
    return this.call<{ ok: boolean; name: string }>(OPS.addBookmark, { name, pos });
  }
  removeBookmarkByName(name: string) {
    return this.call<{ ok: boolean; name: string }>(OPS.removeBookmark, { name });
  }
  removeBookmarkAt(pos: Pos) {
    return this.call<{ ok: boolean; name: string }>(OPS.removeBookmark, { pos });
  }
  /** Read-only; sorted by document position then name. */
  listBookmarks() {
    return this.call<{ bookmarks: Bookmark[] }>(OPS.listBookmarks);
  }
  /**
   * Start a new section at block `at` (1..block count, not already a section
   * start). The new section copies the page setup and header/footer of the
   * section owning `at`; `page_setup`/`header_footer` partial patches
   * override the copy. Boundaries track block edits like bookmarks do.
   */
  insertSection(
    at: number,
    options: { page_setup?: PageSetupPatch; header_footer?: HeaderFooterPatch } = {},
  ) {
    return this.call<{ ok: boolean; section: number }>(OPS.insertSection, {
      at,
      ...(options.page_setup === undefined ? {} : { page_setup: options.page_setup }),
      ...(options.header_footer === undefined
        ? {}
        : { header_footer: options.header_footer }),
    });
  }
  /**
   * Delete the boundary at `section`, merging its blocks into the previous
   * section (which keeps its own settings). The first section cannot be
   * removed.
   */
  removeSection(section: number) {
    return this.call<{ ok: boolean }>(OPS.removeSection, { section });
  }
  /** Patch page-setup fields on one section; the merged result is validated. */
  setPageSetup(section: number, patch: PageSetupPatch) {
    return this.call<{ ok: boolean; section: number }>(OPS.setPageSetup, {
      section,
      ...patch,
    });
  }
  /**
   * Patch header/footer fields on one section. String bodies accept a
   * string or null (clear); the rest are typed. At most 8192 characters
   * per body.
   */
  setHeaderFooter(section: number, patch: HeaderFooterPatch) {
    return this.call<{ ok: boolean; section: number }>(OPS.setHeaderFooter, {
      section,
      ...patch,
    });
  }
  /** Read-only; sections in document order. */
  listSections() {
    return this.call<{ sections: SectionInfo[] }>(OPS.listSections);
  }
  /**
   * Define a durable named style. Ids are unique, 1–64 non-blank
   * non-control characters; at most 256 definitions.
   */
  defineStyle(def: { id: string; name: string; kind: NamedStyleKind; properties: NamedStyleProperties }) {
    return this.call<{ ok: boolean; id: string }>(OPS.defineStyle, def);
  }
  /** Replace `name`/`properties` on an existing style; never propagates. */
  updateStyle(id: string, changes: { name?: string; properties?: NamedStyleProperties }) {
    return this.call<{ ok: boolean; id: string }>(OPS.updateStyle, { id, ...changes });
  }
  /**
   * Delete a style definition and clear paragraph-style references on
   * blocks that used it. Properties already copied onto inlines remain.
   */
  removeStyle(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.removeStyle, { id });
  }
  /** Read-only; definitions sorted by id. */
  listStyles() {
    return this.call<{ styles: NamedStyle[] }>(OPS.listStyles);
  }
  /**
   * Anchor a comment to the `from..to` range (`from == to` anchors a
   * point). Ids are unique tokens, 1–64 non-blank non-control characters;
   * at most 1024 comments. `resolved` defaults to false.
   */
  addComment(comment: {
    id: string;
    from: Pos;
    to: Pos;
    author?: string;
    body: string;
    resolved?: boolean;
  }) {
    return this.call<{ ok: boolean; id: string }>(OPS.addComment, comment);
  }
  /**
   * Replace `body` and/or `author` on a comment; `author: null` clears.
   * Absent fields keep their values; no effective change is eventless.
   * Anchors cannot be re-pointed — they move only through document edits.
   */
  updateComment(id: string, changes: { author?: string | null; body?: string }) {
    return this.call<{ ok: boolean; id: string }>(OPS.updateComment, { id, ...changes });
  }
  removeComment(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.removeComment, { id });
  }
  /** Set `resolved: true`; already-resolved is eventless. */
  resolveComment(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.resolveComment, { id });
  }
  /** Set `resolved: false`; already-open is eventless. */
  reopenComment(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.reopenComment, { id });
  }
  /** Read-only; sorted by anchor position then id. */
  listComments() {
    return this.call<{ comments: DocComment[] }>(OPS.listComments);
  }
  /**
   * Anchor a footnote/endnote reference at `at` (`pos`/`anchor` payload
   * aliases accepted). `kind` is `"footnote"` (default) or `"endnote"`;
   * `body` is optional plain text ≤8192 chars (empty allowed); `id` is an
   * optional unique token — absent, the engine assigns the smallest unused
   * `fn-N`. Anchors on table blocks reject; at most 1024 notes.
   */
  addFootnote(note: {
    at: Pos;
    kind?: FootnoteKind;
    body?: string;
    id?: string;
  }) {
    return this.call<{ ok: boolean; id: string; kind: FootnoteKind }>(
      OPS.addFootnote,
      note,
    );
  }
  /**
   * Replace `body` and/or `kind` on a footnote; `body: null` clears to
   * empty, `kind` moves the note between the footnote/endnote sequences.
   * Absent fields keep their values; anchors are not re-pointable; no
   * effective change is eventless.
   */
  updateFootnote(id: string, changes: { body?: string | null; kind?: FootnoteKind }) {
    return this.call<{ ok: boolean; id: string }>(OPS.updateFootnote, {
      id,
      ...changes,
    });
  }
  removeFootnote(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.removeFootnote, { id });
  }
  /**
   * Read-only; sorted by anchor position then id, each entry carrying its
   * resolved `number` — footnotes and endnotes number independently in
   * document order.
   */
  listFootnotes() {
    return this.call<{ footnotes: Footnote[] }>(OPS.listFootnotes);
  }
  /**
   * Insert a `kind:"toc"` field block at `index` (0..=block count) and
   * populate its entries from a live heading scan. `from_level`/`to_level`
   * are inclusive heading levels 1..=3 (h1/h2/h3 block kinds); both
   * default to the full 1..=3 range. At most 64 fields per document.
   * Anchor remapping matches `insertBlock` for every collection.
   */
  insertToc(index: number, levels: { from_level?: number; to_level?: number } = {}) {
    return this.call<{ ok: boolean; block_index: number }>(OPS.insertToc, {
      index,
      ...(levels.from_level === undefined ? {} : { from_level: levels.from_level }),
      ...(levels.to_level === undefined ? {} : { to_level: levels.to_level }),
    });
  }
  /**
   * Repoint a toc field's level range (absent fields keep their values)
   * and rescan its entries in one step — a reconfigured field never shows
   * entries outside its new range. No effective change is eventless.
   */
  updateToc(block: number, levels: { from_level?: number; to_level?: number }) {
    return this.call<{ ok: boolean; block: number }>(OPS.updateToc, {
      block,
      ...levels,
    });
  }
  /**
   * Regenerate a toc field's cached entries from the live document (the
   * Word "update field" gesture). Entries whose heading blocks were
   * deleted drop; identical result is eventless.
   */
  refreshToc(block: number) {
    return this.call<{ ok: boolean; block: number }>(OPS.refreshToc, { block });
  }
  /**
   * Read-only live scan — always current, never a cached copy. With
   * `block` naming a toc field the scan honors that field's level range;
   * without it all headings levels 1..=3 are reported. Entries carry
   * `{level,title,block}`; page numbers are a host concern.
   */
  listToc(block?: number) {
    return this.call<TocListing>(OPS.listToc, {
      ...(block === undefined ? {} : { block }),
    });
  }
  /**
   * Read-only live scan for `{{name}}` mail-merge field tokens in block
   * text (table cell text included). Fields are plain text — the token
   * grammar is `{{name}}` with the inner text trimmed; names are 1–64
   * chars without braces or control characters, matched exactly and
   * case-sensitively. Results are in first-appearance document order.
   */
  listMergeFields() {
    return this.call<MergeFieldScan>(OPS.listMergeFields);
  }
  /**
   * Read-only mail-merge preview: merge each record over the whole
   * document (the `text`-op serialization, tables included) without
   * touching the document. `records` are data-source rows — objects
   * mapping field names to single-line string values; the engine does
   * no I/O, so hosts parse CSV/DB sources themselves. At most 1024
   * records, 256 fields per record, 8192 chars per value. Fields a
   * record does not define merge as "" and are listed in `missing`;
   * record keys matching no document field are ignored.
   */
  previewMerge(records: MergeRecord[]) {
    return this.call<MergePreviewResult>(OPS.previewMerge, { records });
  }
  /**
   * Merge one record into the document: every `{{name}}` token in the
   * optional `from..to` range (default whole document; table cells are
   * covered under the same range rules as `findText`/`replaceText`) is
   * replaced by the record's value as one undo step. Replacement text
   * inherits the token's first-scalar style. Missing fields merge as ""
   * and are reported; merge is single-pass — substituted values are
   * never rescanned. No tokens in range is eventless.
   */
  runMerge(record: MergeRecord, range: { from?: Pos; to?: Pos } = {}) {
    return this.call<MergeRunResult>(OPS.runMerge, {
      record,
      ...(range.from === undefined ? {} : { from: range.from }),
      ...(range.to === undefined ? {} : { to: range.to }),
    });
  }
  /**
   * Define a bibliography source. `author`/`title` are required; the
   * optional metadata fields are raw strings ≤512 chars (never parsed —
   * no DOI/URL fetching). `id` is an optional unique token — absent, the
   * engine assigns the smallest unused `src-N`. At most 1024 sources.
   */
  addSource(source: {
    author: string;
    title: string;
    year?: string;
    container?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    doi?: string;
    url?: string;
    note?: string;
    id?: string;
  }) {
    return this.call<{ ok: boolean; id: string }>(OPS.addSource, source);
  }
  /**
   * Patch a source's fields; absent keys keep their values, explicit
   * null clears an optional field (author/title reject null). No
   * effective change is eventless; cached bibliography entries are not
   * rewritten — refresh the field.
   */
  updateSource(
    id: string,
    changes: {
      author?: string;
      title?: string;
      year?: string | null;
      container?: string | null;
      volume?: string | null;
      issue?: string | null;
      pages?: string | null;
      doi?: string | null;
      url?: string | null;
      note?: string | null;
    },
  ) {
    return this.call<{ ok: boolean; id: string }>(OPS.updateSource, {
      id,
      ...changes,
    });
  }
  /**
   * Delete a source AND every citation that referenced it (one undo
   * step) — the Word "delete source" cascade.
   */
  removeSource(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.removeSource, { id });
  }
  /** Read-only; sources sorted by id with citation counts. */
  listSources() {
    return this.call<{ sources: SourceInfo[] }>(OPS.listSources);
  }
  /**
   * Anchor an in-text citation at `at` (`pos`/`anchor` payload aliases
   * accepted) naming an existing source. `locator` is optional free text
   * ≤128 chars; `id` is an optional unique token — absent, the engine
   * assigns the smallest unused `cit-N`. Anchors on table/toc/
   * bibliography field blocks reject; at most 2048 citations.
   */
  addCitation(citation: {
    at: Pos;
    source: string;
    locator?: string;
    id?: string;
  }) {
    return this.call<{ ok: boolean; id: string }>(OPS.addCitation, citation);
  }
  /**
   * Re-point `source` to another existing source and/or patch `locator`
   * (`null` clears). Absent fields keep their values; anchors are not
   * re-pointable; no effective change is eventless.
   */
  updateCitation(
    id: string,
    changes: { source?: string; locator?: string | null },
  ) {
    return this.call<{ ok: boolean; id: string }>(OPS.updateCitation, {
      id,
      ...changes,
    });
  }
  removeCitation(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.removeCitation, { id });
  }
  /**
   * Read-only; sorted by anchor position then id, each entry carrying its
   * resolved 1-based `number` in document order.
   */
  listCitations() {
    return this.call<{ citations: Citation[] }>(OPS.listCitations);
  }
  /**
   * Insert a `kind:"bibliography"` field block at `index` (0..=block
   * count) and populate its cached entries from a live scan of the cited
   * sources. `sort` is `"alpha"` (default, formatted-text order) or
   * `"citation"` (first-citation document order). At most 64 fields.
   */
  insertBibliography(
    index: number,
    options: { sort?: BibliographySort } = {},
  ) {
    return this.call<{ ok: boolean; block_index: number }>(
      OPS.insertBibliography,
      {
        index,
        ...(options.sort === undefined ? {} : { sort: options.sort }),
      },
    );
  }
  /**
   * Repoint a bibliography field's entry ordering (absent keeps it) and
   * rescan its entries in one step. No effective change is eventless.
   */
  updateBibliography(block: number, options: { sort?: BibliographySort } = {}) {
    return this.call<{ ok: boolean; block: number }>(OPS.updateBibliography, {
      block,
      ...(options.sort === undefined ? {} : { sort: options.sort }),
    });
  }
  /**
   * Regenerate a bibliography field's cached entries from the live
   * citations/sources (the Word "update field" gesture). Identical
   * result is eventless.
   */
  refreshBibliography(block: number) {
    return this.call<{ ok: boolean; block: number }>(OPS.refreshBibliography, {
      block,
    });
  }
  /**
   * Read-only live scan — always current, never the cache. With `block`
   * naming a bibliography field the scan honors that field's `sort`;
   * without it entries sort `"alpha"`. Only cited sources appear.
   */
  listBibliography(block?: number) {
    return this.call<BibliographyListing>(OPS.listBibliography, {
      ...(block === undefined ? {} : { block }),
    });
  }
  /**
   * Enable/disable track changes. While enabled, `insertText`,
   * `deleteRange` and `replaceRange` record `ins`/`del` revisions stamped
   * with `author` (the default; per-edit `RevisionAttribution` overrides).
   * `author` is a patch: a string sets it, null clears it, absent keeps
   * the current value. The setting persists in snapshots. Tracking caps
   * drop silently: edits still apply with no revision recorded once 1024
   * records exist or a deletion's plain text exceeds 65536 chars.
   */
  setTrackChanges(enabled: boolean, author?: string | null) {
    return this.call<{ ok: boolean; enabled: boolean }>(OPS.setTrackChanges, {
      enabled,
      ...(author === undefined ? {} : { author }),
    });
  }
  /** Read-only; pending revisions sorted by anchor position then id. */
  listRevisions() {
    return this.call<{ revisions: Revision[] }>(OPS.listRevisions);
  }
  /**
   * Resolve one revision: `ins` accept keeps the marked text, `ins`
   * reject deletes the marked range; `del` accept drops the record and
   * `del` reject re-inserts the stored plain text — styles are not
   * restored.
   */
  acceptRevision(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.acceptRevision, { id });
  }
  rejectRevision(id: string) {
    return this.call<{ ok: boolean; id: string }>(OPS.rejectRevision, { id });
  }
  /**
   * Resolve every pending revision in document order as one undo step.
   * `kind` optionally filters to `"ins"` or `"del"`; a revision whose
   * decision cannot apply is left pending. Returns the resolved count.
   */
  acceptAllRevisions(kind?: RevisionKind) {
    return this.call<{ ok: boolean; applied: number }>(OPS.acceptAllRevisions, {
      ...(kind === undefined ? {} : { kind }),
    });
  }
  rejectAllRevisions(kind?: RevisionKind) {
    return this.call<{ ok: boolean; applied: number }>(OPS.rejectAllRevisions, {
      ...(kind === undefined ? {} : { kind }),
    });
  }
  /**
   * Copy a `"character"` style's properties onto the inlines in `from..to`
   * (same re-split rules as `applyStyle`). Present properties overwrite —
   * including null clears; absent properties leave inline values untouched.
   */
  applyNamedStyle(styleId: string, from: Pos, to: Pos) {
    return this.call(OPS.applyNamedStyle, { style_id: styleId, from, to });
  }
  /**
   * Attach a `"paragraph"` style to a block: stamps its properties onto the
   * block's inlines and records `style_id` (visible via `blocks`/`describe`).
   * `null` clears only the reference; stamped properties are not reverted.
   */
  setBlockStyle(block: number, styleId: string | null) {
    return this.call(OPS.setBlockStyle, { block, style_id: styleId });
  }
  /**
   * Patch one block's paragraph format (alignment, indents, tab stops —
   * P12 slice 9). Present keys set, `null` clears, absent keys untouched;
   * pass every field as `null` (or `tabs: []`) to clear all formatting.
   * Indents/tab positions are twips; `indent_first` negative means
   * hanging. Rejects table blocks; equal values are eventless. Storage-
   * only: no layout consumes the values yet.
   */
  setParagraphFormat(block: number, patch: ParagraphFormatPatch) {
    const { block: _ignored, ...rest } = patch as ParagraphFormatPatch & { block?: number };
    return this.call(OPS.setParagraphFormat, { block, ...rest });
  }
  /**
   * Insert a `rows`x`cols` table (each cell starts with one empty
   * paragraph) as a single block at `index` (0..=block count). Cell
   * styling and DOCX table interop are deferred.
   */
  insertTable(index: number, rows: number, cols: number) {
    return this.call<{ ok: boolean; block_index: number }>(OPS.insertTable, {
      index,
      rows,
      cols,
    });
  }
  /** Remove a table block entirely; anchors remap like a single-block delete. */
  deleteTable(block: number) {
    return this.call<{ ok: boolean }>(OPS.deleteTable, { block });
  }
  /**
   * Replace one cell's content with plain paragraphs: `text` splits on "\n"
   * into at most 64 paragraphs of at most 8192 characters total; empty text
   * yields one empty paragraph. Cell content is unreachable by `Pos`, so
   * top-level anchors never move.
   */
  setCellText(block: number, row: number, col: number, text: string) {
    return this.call<{ ok: boolean }>(OPS.setCellText, { block, row, col, text });
  }
  /**
   * Insert one row of empty cells before `row` (0..=rows; `rows` appends).
   * The table must stay within 64 rows; new cell blocks count against the
   * document-wide cell-block budget.
   */
  insertTableRow(block: number, row: number) {
    return this.call<{ ok: boolean }>(OPS.insertTableRow, { block, row });
  }
  /** Remove row `row` and its cell content; a table must keep ≥1 row. */
  deleteTableRow(block: number, row: number) {
    return this.call<{ ok: boolean }>(OPS.deleteTableRow, { block, row });
  }
  /**
   * Insert one column of empty cells before `col` (0..=cols; `cols`
   * appends). The table must stay within 26 columns.
   */
  insertTableColumn(block: number, col: number) {
    return this.call<{ ok: boolean }>(OPS.insertTableColumn, { block, col });
  }
  /** Remove column `col` and its cell content; a table must keep ≥1 column. */
  deleteTableColumn(block: number, col: number) {
    return this.call<{ ok: boolean }>(OPS.deleteTableColumn, { block, col });
  }
  /** Read-only; table blocks in document order. */
  listTables() {
    return this.call<{ tables: TableInfo[] }>(OPS.listTables);
  }
  /** Read-only; one table's dimensions and row-major cell text grid. */
  describeTable(block: number) {
    return this.call<TableDescription>(OPS.describeTable, { block });
  }
  /**
   * Merge the rectangular cell region between `from` and `to` (either
   * order; the top-left cell is the anchor and keeps its content). The
   * region must cover at least 2 cells, stay in bounds, and not overlap
   * an existing merge; covered cells' content is discarded.
   */
  mergeTableCells(
    block: number,
    from: { row: number; col: number },
    to: { row: number; col: number },
  ) {
    return this.call<{ ok: boolean }>(OPS.mergeTableCells, { block, from, to });
  }
  /**
   * Remove the merge whose region contains cell (`row`,`col`) — anchor
   * or covered cell alike. Covered cells return as ordinary empty cells.
   */
  unmergeTableCells(block: number, row: number, col: number) {
    return this.call<{ ok: boolean }>(OPS.unmergeTableCells, { block, row, col });
  }
  blocks<T = unknown>() {
    return this.call<T>(OPS.blocks);
  }
  /**
   * Greedy wrap pagination. Line `{block,start,end}` spans index the
   * same per-block serialization `text` reports — for a table block
   * that is the cell-grid serialization above; no cell geometry is
   * modeled.
   *
   * Without `font`, widths are the legacy 0.5em estimate. With `font`
   * naming a family admitted via `registerFont`, lines wrap on real
   * unhinted advance widths from that face (no shaping/kerning — see
   * docs/completion/reports/P-font-glyph-backend-decision.md).
   */
  layout(pageWidth: number, fontSize: number, pageHeight?: number, font?: string) {
    return this.call<{ pages: LayoutPage[] }>(OPS.layout, {
      page_width: pageWidth,
      font_size: fontSize,
      ...(pageHeight === undefined ? {} : { page_height: pageHeight }),
      ...(font === undefined ? {} : { font }),
    });
  }

  /**
   * Admit one font face into the engine session's font registry
   * (`registerFont`). `bytes` are the raw font file (TTF/OTF/TTC face);
   * `faceIndex` selects inside a collection (default 0). The registry is
   * session state — it is not part of the document snapshot and is not
   * covered by undo. Bounds: ≤16 MiB per face, ≤64 faces, ≤256 MiB total.
   * Re-registering the same family+bytes+face is an idempotent no-op.
   */
  registerFont(family: string, bytes: Uint8Array, faceIndex = 0) {
    return this.call<{
      family: string;
      sha256: string;
      face_index: number;
      units_per_em: number;
      num_glyphs: number;
      registered: boolean;
    }>(OPS.registerFont, {
      family,
      ...(faceIndex === 0 ? {} : { face_index: faceIndex }),
      bytes_b64: bytesToBase64(bytes),
    });
  }

  /** Drop every registered face sharing a content sha256 (from `registerFont`/`listFonts`). */
  removeFont(sha256: string) {
    return this.call<{ removed: number }>(OPS.removeFont, { sha256 });
  }

  /** Read-only census of the session font registry. */
  listFonts() {
    return this.call<{
      fonts: {
        family: string;
        sha256: string;
        face_index: number;
        units_per_em: number;
        num_glyphs: number;
      }[];
    }>(OPS.listFonts, {});
  }
  async exportDocx() {
    const r = await this.call<{ bytes_b64: string }>(OPS.exportDocx);
    return base64ToBytes(r.data.bytes_b64);
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
