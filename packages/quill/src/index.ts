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
  setBlockKind: "setBlockKind",
  insertBlock: "insertBlock",
  splitBlock: "splitBlock",
  mergeBlock: "mergeBlock",
  text: "text",
  blocks: "blocks",
  layout: "layout",
  exportDocx: "exportDocx",
  importDocx: "importDocx",
} as const;

export type BlockKind = "para" | "h1" | "h2" | "h3" | "list" | "quote";

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
    const doc = await DocumentHandle.openInitialized(host, "quill",
      (document) => document.restore(bytes));
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
  applyStyle(from: Pos, to: Pos, style: Style) {
    return this.call(OPS.applyStyle, { from, to, style });
  }
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
