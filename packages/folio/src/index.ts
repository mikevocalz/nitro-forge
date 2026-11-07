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
  addInkAnnotation: "addInkAnnotation",
  addLinkAnnotation: "addLinkAnnotation",
  listAnnotations: "listAnnotations",
  listCommentThreads: "listCommentThreads",
  addAnnotationReply: "addAnnotationReply",
  setAnnotationReview: "setAnnotationReview",
  removeAnnotation: "removeAnnotation",
  setAnnotationContents: "setAnnotationContents",
  rotatePage: "rotatePage",
  encrypt: "encrypt",
  decrypt: "decrypt",
  save: "save",
  info: "info",
} as const;

export type Rect = [number, number, number, number]; // x, y, w, h (PDF user space)
/**
 * PDF annotation subtypes. `Ink`/`Link` are listed for completeness — create
 * them through `addInkAnnotation`/`addLinkAnnotation`; `addAnnotation`
 * rejects those subtypes.
 */
export type AnnotSubtype =
  | "Text" | "Highlight" | "Underline" | "StrikeOut" | "Square" | "Circle"
  | "Ink" | "Link";
/** One ink stroke: an array of at least 2 `[x, y]` points in PDF user space. */
export type InkStroke = readonly (readonly [number, number])[];
export type InkPaths = readonly InkStroke[];
/** PDF Standard-handler permission names accepted by `encrypt` (all granted when omitted). */
export type FolioPermission =
  | "print" | "modify" | "copy" | "annotate" | "fill"
  | "accessibility" | "assemble" | "printHighQuality";
export interface FolioEncryptOptions {
  /** Required user password: non-empty, at most 127 UTF-8 bytes. */
  password: string;
  /** Optional owner password (defaults to `password`). lopdf 0.36 cannot decrypt with an owner-only password — see docs/ENGINE_OPS.md. */
  ownerPassword?: string;
  /** Granted permissions; omit for all. */
  permissions?: readonly FolioPermission[];
  /** Encrypt document metadata too (default true). */
  encryptMetadata?: boolean;
}

export interface Annotation {
  id: number;
  subtype: string;
  rect: Rect;
  contents: string;
  /** Present on `/Link` annotations with a `/URI` action. */
  uri?: string;
  /** Present when the annotation carries an explicit `/Dest`. */
  dest?: string | number[];
}

export interface FolioCommentMetadata { author: string; modified: string }
export interface FolioCommentEntry { id: number; contents: string; author?: string; modified?: string }
export interface FolioCommentThread extends FolioCommentEntry { subtype: string; rect: Rect | null; replies: FolioCommentEntry[]; resolved?: boolean; review_state?: string }

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
    metadata?: FolioCommentMetadata,
  ) {
    return this.call<{ annot_id: number }>(OPS.addAnnotation, {
      page,
      rect,
      contents,
      subtype,
      ...(metadata === undefined ? {} : { author: metadata.author, modified: metadata.modified }),
    });
  }
  /**
   * Freehand ink annotation (`/Subtype /Ink`). `paths` is 1–64 strokes of
   * `[x, y]` points (≥2 per stroke, ≤2048 points total, coordinates finite
   * within ±1 000 000 PDF units). `color` is an optional `[r, g, b]` triplet
   * in 0..=1; `width` the `/BS` stroke width in points (default 1, max 100);
   * `opacity` 0..=1 emits `/CA`. `/Rect` is derived from the stroke bounds.
   */
  addInkAnnotation(
    page: number,
    paths: InkPaths,
    options: {
      color?: [number, number, number];
      width?: number;
      opacity?: number;
      contents?: string;
      metadata?: FolioCommentMetadata;
    } = {},
  ) {
    return this.call<{ annot_id: number }>(OPS.addInkAnnotation, {
      page,
      paths,
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
      ...(options.contents === undefined ? {} : { contents: options.contents }),
      ...(options.metadata === undefined ? {} : { author: options.metadata.author, modified: options.metadata.modified }),
    });
  }
  /**
   * URI link annotation (`/Subtype /Link`, `/A << /S /URI /URI (…) >>`).
   * `rect` is `[x, y, w, h]` in PDF user space and must be positive,
   * nondegenerate and within ±1 000 000. `uri` must be non-empty, ≤2048
   * bytes, carry a valid scheme and contain no whitespace or control
   * characters.
   */
  addLinkAnnotation(
    page: number,
    rect: Rect,
    uri: string,
    options: { contents?: string; metadata?: FolioCommentMetadata } = {},
  ) {
    return this.call<{ annot_id: number }>(OPS.addLinkAnnotation, {
      page,
      rect,
      uri,
      ...(options.contents === undefined ? {} : { contents: options.contents }),
      ...(options.metadata === undefined ? {} : { author: options.metadata.author, modified: options.metadata.modified }),
    });
  }
  listCommentThreads(page: number, reviewAuthor?: string) {
    return this.call<{ threads: FolioCommentThread[] }>(OPS.listCommentThreads, { page, ...(reviewAuthor === undefined ? {} : { review_author: reviewAuthor }) });
  }
  addAnnotationReply(page: number, id: number, contents: string, metadata: FolioCommentMetadata) {
    return this.call<{ annot_id: number }>(OPS.addAnnotationReply, { page, id, contents, author: metadata.author, modified: metadata.modified });
  }
  setAnnotationReview(page: number, id: number, resolved: boolean, metadata: FolioCommentMetadata) {
    return this.call<{ annot_id: number } | { ok: true }>(OPS.setAnnotationReview, { page, id, resolved, author: metadata.author, modified: metadata.modified });
  }
  listAnnotations(page: number) {
    return this.call<{ annots: Annotation[] }>(OPS.listAnnotations, { page });
  }
  /** Edit a page-owned Text/Highlight comment; PDF text string encoding is handled by the engine. */
  setAnnotationContents(page: number, id: number, contents: string) {
    return this.call<{ ok: boolean }>(OPS.setAnnotationContents, { page, id, contents });
  }
  removeAnnotation(page: number, id: number) {
    return this.call(OPS.removeAnnotation, { page, id });
  }
  /** Engine validates: degrees must be a multiple of 90. */
  rotatePage(page: number, degrees: number) {
    return this.call(OPS.rotatePage, { page, degrees });
  }
  /** Encrypt the document in place (V4/R4, AES-128). One undo entry; saved bytes stay encrypted. */
  encrypt(options: FolioEncryptOptions) {
    return this.call<{ ok: boolean; encrypted: boolean }>(OPS.encrypt, {
      password: options.password,
      ...(options.ownerPassword === undefined ? {} : { owner_password: options.ownerPassword }),
      ...(options.permissions === undefined ? {} : { permissions: [...options.permissions] }),
      ...(options.encryptMetadata === undefined ? {} : { encrypt_metadata: options.encryptMetadata }),
    });
  }
  /** Decrypt with the user password. Wrong password → EngineError, document untouched. */
  decrypt(password: string) {
    return this.call<{ ok: boolean; encrypted: boolean }>(OPS.decrypt, { password });
  }
  /** Serialize the working PDF (lopdf) — real PDF bytes. */
  async savePdf() {
    const r = await this.call<{ bytes_b64: string; size: number }>(OPS.save);
    return { bytes: base64ToBytes(r.data.bytes_b64), size: r.data.size };
  }
  info() {
    return this.call<{ pages: number; has_annots: boolean; encrypted: boolean }>(OPS.info);
  }
  /** True when the document still holds ciphertext and needs `decrypt`. */
  async isEncrypted() {
    return (await this.info()).data.encrypted;
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
