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
  blocks: "blocks",
  layout: "layout",
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
export interface FindOptions {
  from?: Pos;
  to?: Pos;
  /** Defaults to false (case-insensitive per-scalar Unicode lowercase). */
  caseSensitive?: boolean;
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

  insertText(at: Pos, text: string) {
    return this.call(OPS.insertText, { at, text });
  }
  deleteRange(from: Pos, to: Pos) {
    return this.call<{ deleted_text: string }>(OPS.deleteRange, { from, to });
  }
  /** Replace `from..to` with `text` as one command and one undo step. */
  replaceRange(from: Pos, to: Pos, text: string) {
    return this.call<{ deleted_text: string }>(OPS.replaceRange, { from, to, text });
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
  text(from?: Pos, to?: Pos) {
    return this.call<{ text: string }>(OPS.text, { from, to });
  }
  /** Read-only search; matches never span block boundaries. */
  findText(query: string, options: FindOptions = {}) {
    return this.call<{ matches: FindMatch[]; count: number }>(OPS.findText, {
      query,
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.to === undefined ? {} : { to: options.to }),
      ...(options.caseSensitive === undefined
        ? {}
        : { case_sensitive: options.caseSensitive }),
    });
  }
  /** Replace every non-overlapping match in range as one undo step. */
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
  blocks<T = unknown>() {
    return this.call<T>(OPS.blocks);
  }
  layout(pageWidth: number, fontSize: number, pageHeight?: number) {
    return this.call<{ pages: LayoutPage[] }>(OPS.layout, {
      page_width: pageWidth,
      font_size: fontSize,
      ...(pageHeight === undefined ? {} : { page_height: pageHeight }),
    });
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
