import {
  DocumentHandle,
  base64ToBytes,
  bytesToBase64,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — mirrors docs/ENGINE_OPS.md § folio. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  open: "open",
  pageCount: "pageCount",
  pageText: "pageText",
  addAnnotation: "addAnnotation",
  listAnnotations: "listAnnotations",
  removeAnnotation: "removeAnnotation",
  rotatePage: "rotatePage",
  save: "save",
  info: "info",
} as const;

export type Rect = [number, number, number, number]; // x, y, w, h (PDF user space)
export type AnnotSubtype = "Text" | "Highlight";

export interface Annotation {
  id: number;
  subtype: string;
  rect: Rect;
  contents: string;
}

export class FolioDocument {
  private constructor(private doc: DocumentHandle) {}

  /** Create a new PDF document with `pages` blank letter pages. */
  static async create(host: EngineHost, pages = 1): Promise<FolioDocument> {
    const doc = await DocumentHandle.openInitialized(host, "folio",
      (document) => document.apply(OPS.newDoc, { pages }));
    return new FolioDocument(doc);
  }

  /** Open an existing PDF file's bytes. */
  static async openPdf(
    host: EngineHost,
    pdfBytes: Uint8Array,
  ): Promise<FolioDocument> {
    const doc = await DocumentHandle.openInitialized(host, "folio",
      (document) => document.apply(OPS.open, { bytes_b64: bytesToBase64(pdfBytes) }));
    return new FolioDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<FolioDocument> {
    const doc = await DocumentHandle.openSnapshot(host, "folio", bytes);
    return new FolioDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }
  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  pageCount() {
    return this.call<{ pages: number }>(OPS.pageCount);
  }
  pageText(page: number) {
    return this.call<{ text: string }>(OPS.pageText, { page });
  }
  addAnnotation(
    page: number,
    rect: Rect,
    contents: string,
    subtype: AnnotSubtype = "Highlight",
  ) {
    return this.call<{ annot_id: number }>(OPS.addAnnotation, {
      page,
      rect,
      contents,
      subtype,
    });
  }
  listAnnotations(page: number) {
    return this.call<{ annots: Annotation[] }>(OPS.listAnnotations, { page });
  }
  removeAnnotation(page: number, id: number) {
    return this.call(OPS.removeAnnotation, { page, id });
  }
  /** Engine validates: degrees must be a multiple of 90. */
  rotatePage(page: number, degrees: number) {
    return this.call(OPS.rotatePage, { page, degrees });
  }
  /** Serialize the working PDF (lopdf) — real PDF bytes. */
  async savePdf() {
    const r = await this.call<{ bytes_b64: string; size: number }>(OPS.save);
    return { bytes: base64ToBytes(r.data.bytes_b64), size: r.data.size };
  }
  info() {
    return this.call<{ pages: number; has_annots: boolean }>(OPS.info);
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
