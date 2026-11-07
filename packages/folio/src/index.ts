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
  movePage: "movePage",
  deletePage: "deletePage",
  duplicatePage: "duplicatePage",
  insertBlankPage: "insertBlankPage",
  listPageInfo: "listPageInfo",
  listOutlines: "listOutlines",
  addBookmark: "addBookmark",
  removeBookmark: "removeBookmark",
  listFormFields: "listFormFields",
  fillFormField: "fillFormField",
  listSignatures: "listSignatures",
  listAttachments: "listAttachments",
  getAttachment: "getAttachment",
  addFileAttachment: "addFileAttachment",
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
/**
 * One node of the PDF outline (bookmark) tree from `listOutlines`.
 * `id` is the outline item dictionary's object number — pass it to
 * `removeBookmark`; `null` for inline items in foreign PDFs, which the
 * mutating outline ops reject anyway. `page` is the 0-based page index
 * the destination resolves to (`null` when unresolvable, e.g. a deleted
 * page ghost). `dest` is the explicit-destination tail (`/Fit` plus
 * coordinates, possibly nested arrays) when the item carries an array
 * destination, or the bare destination name string when it stays
 * unresolved (e.g. a named destination that does not decode).
 */
export interface FolioOutlineItem {
  id: number | null;
  title: string;
  page: number | null;
  dest?: string | unknown[];
  children: FolioOutlineItem[];
}

/**
 * One widget annotation from `listFormFields`. `name` is the flattened
 * field name (`/T` partial names joined with `.`); `ft` is the resolved
 * field type (`Tx`/`Btn`/`Ch`/`Sig` or a foreign name, `null` when no
 * `/FT` resolves); `v` is the current `/V` — decoded text for `Tx`/`Ch`,
 * the state name for `Btn`, an array for multi-value choice fields,
 * `null` when absent or undecodable; `ff` the resolved `/Ff` flags or
 * null; `rect` `[x, y, w, h]` or null; `signature` true for `/FT /Sig`;
 * `annot` the widget's `/Annots` object number — pass it back to
 * `fillFormField` as `{annot}` (`null` for inline foreign widgets).
 */
export interface FolioFormField {
  page: number;
  name: string;
  ft: string | null;
  v: string | (string | null)[] | null;
  ff: number | null;
  rect: Rect | null;
  signature: boolean;
  annot: number | null;
}

/**
 * One signature field from `listSignatures`. `signed` is true only when
 * the field's `/V` resolves to a signature dictionary; the detail fields
 * then report what the parsed object model honestly contains — there is
 * NO cryptographic verification. `byte_range` is the `/ByteRange` array
 * when it holds only integers (`null` otherwise);
 * `byte_range_well_formed` is a shape check only (four non-negative
 * integers, second pair starting at/after the end of the first) and is
 * never validated against file bytes. `page`/`annot` are `null` for
 * signature fields whose widgets never appear on a page.
 */
export interface FolioSignature {
  name: string;
  page: number | null;
  annot: number | null;
  signed: boolean;
  byte_range: number[] | null;
  byte_range_well_formed: boolean;
  sub_filter: string | null;
  signer: string | null;
  date: string | null;
  reason: string | null;
  contact: string | null;
  location: string | null;
  signature_type: string | null;
}

/**
 * One embedded-file attachment from `listAttachments`. `size` is the
 * embedded stream's declared `/Params` `/Size` (uncompressed length) or
 * `null` when absent — never the possibly-compressed `/Length`.
 */
export interface FolioAttachmentInfo {
  name: string;
  size: number | null;
  description: string | null;
}

/** One row of `listPageInfo`; `mediabox` is `[x1, y1, x2, y2]` PDF user space or null. */
export interface FolioPageInfo {
  index: number;
  mediabox: [number, number, number, number] | null;
  rotate: number;
  annots_count: number;
  /** True when the page's decoded content streams carry bytes; null on encrypted documents (streams are ciphertext). */
  has_contents: boolean | null;
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
  /**
   * Reorder pages: the page at 0-based `from` is removed and reinserted at
   * `to`. Both indices must be within the current page count; `from === to`
   * is an eventless no-op. Structural page ops rewrite the page tree flat
   * under the root `/Pages` node, garbage-collect objects that become
   * unreachable, and reject on encrypted documents (decrypt first).
   */
  movePage(from: number, to: number) {
    return this.call<{ ok: boolean }>(OPS.movePage, { from, to });
  }
  /**
   * Delete the page at 0-based `page`. Rejects when it is the last
   * remaining page or when the document is encrypted; objects reachable
   * only through the deleted page (its exclusive content streams and
   * annotations) are collected. Inbound named destinations and outline
   * actions that referenced the deleted page keep it reachable as an
   * orphaned `/Type /Page` object — see docs/ENGINE_OPS.md.
   */
  deletePage(page: number) {
    return this.call<{ ok: boolean }>(OPS.deletePage, { page });
  }
  /**
   * Deep-copy the page at 0-based `page` and insert the copy immediately
   * after it; resolves to the copy's index. Rejects on encrypted
   * documents. The copy shares `/Contents` streams and `/Resources` with
   * the source but gets fresh annotation objects, so editing or deleting
   * one page's annotations never touches the other's; `/StructParents`
   * and `/B` are stripped from the copy.
   */
  duplicatePage(page: number) {
    return this.call<{ ok: boolean; page: number }>(OPS.duplicatePage, { page });
  }
  /**
   * Insert a blank US-Letter page at 0-based `index` (`0..=pageCount`;
   * `pageCount` appends). Resolves to the new page's index. Rejects on
   * encrypted documents.
   */
  insertBlankPage(index: number) {
    return this.call<{ ok: boolean; page: number }>(OPS.insertBlankPage, { index });
  }
  /** Per-page details: index, inherited-aware mediabox/rotate, annot count, content presence. */
  listPageInfo() {
    return this.call<{ pages: FolioPageInfo[] }>(OPS.listPageInfo);
  }
  /**
   * The document's outline (bookmark) tree, nested. Read-only; rejects on
   * encrypted documents because outline titles are ciphertext — decrypt
   * first. Outline `page` fields track page object ids, so they stay
   * correct across `movePage`/`duplicatePage`/`insertBlankPage`.
   */
  listOutlines() {
    return this.call<{ outlines: FolioOutlineItem[] }>(OPS.listOutlines);
  }
  /**
   * Append an outline item as the last child of `parent` (an item `id`
   * from `listOutlines`/`addBookmark`) or at the top level when `parent`
   * is omitted. `page` is the 0-based page index. `title` must be
   * non-empty, ≤2048 UTF-16 code units. Rejects on encrypted documents
   * and on foreign trees containing inline outline dictionaries.
   * Resolves to `{ ok, id }` — the stable id `removeBookmark` takes.
   */
  addBookmark(title: string, page: number, parent?: number) {
    return this.call<{ ok: boolean; id: number }>(OPS.addBookmark, {
      title,
      page,
      ...(parent === undefined ? {} : { parent }),
    });
  }
  /**
   * Remove the outline item `id` and its whole descendant subtree,
   * repairing sibling/parent links and recounting. Rejects when a
   * surviving object still references the removed subtree.
   */
  removeBookmark(id: number) {
    return this.call<{ ok: boolean }>(OPS.removeBookmark, { id });
  }
  /**
   * Every form widget on every page, flattened. Read-only; rejects on
   * encrypted documents (field names and values are ciphertext) —
   * `decrypt` first. Capped at 10 000 fields.
   */
  listFormFields() {
    return this.call<{ fields: FolioFormField[] }>(OPS.listFormFields);
  }
  /**
   * Set a form field's `/V`. `target` is `{field}` — the flattened name
   * from `listFormFields`, matched on `page` (ambiguous names reject;
   * use `{annot}` with the widget's object number instead) — or
   * `{annot}`. `value` is always a string: `Tx`/`Ch` store it as a text
   * string, `Btn` treats it as an appearance-state name (`""`, `off`,
   * `false`, `no`, `0` clear to `/Off`; radio groups match the name
   * against kid `/AP` states). Signature and pushbutton fields reject,
   * as do encrypted documents. Appearance streams are NOT regenerated —
   * the engine sets `/NeedAppearances true` on the AcroForm dict.
   * Filling the current value is an eventless no-op.
   */
  fillFormField(
    page: number,
    target: { field: string } | { annot: number },
    value: string,
  ) {
    return this.call<{ ok: boolean }>(OPS.fillFormField, {
      page,
      ...target,
      value,
    });
  }
  /**
   * Every `/FT /Sig` form field, deduplicated by field dictionary.
   * Read-only; rejects on encrypted documents (names and signature
   * strings are ciphertext) — `decrypt` first. Reports signature
   * dictionary contents (`/ByteRange`, `/SubFilter`, signer `/Name`,
   * `/M`, `/Reason`, `/ContactInfo`, `/Location`, `/Type`) WITHOUT any
   * cryptographic verification — see `FolioSignature`.
   */
  listSignatures() {
    return this.call<{ signatures: FolioSignature[] }>(OPS.listSignatures);
  }
  /**
   * Every `/Names`→`/EmbeddedFiles` attachment: name, declared
   * `/Params` `/Size` (null when absent) and `/Desc`. Read-only;
   * rejects on encrypted documents.
   */
  listAttachments() {
    return this.call<{ attachments: FolioAttachmentInfo[] }>(OPS.listAttachments);
  }
  /**
   * Extract one attachment's decoded bytes by name (≤64 MiB engine
   * cap). Resolves `{name, size}` plus `bytes_b64` in `data`.
   */
  async getAttachment(name: string) {
    const r = await this.call<{ name: string; size: number; bytes_b64: string }>(
      OPS.getAttachment,
      { name },
    );
    return {
      name: r.data.name,
      size: r.data.size,
      bytes: base64ToBytes(r.data.bytes_b64),
    };
  }
  /**
   * Embed a file attachment: `/EmbeddedFile` stream (with `/Params`
   * `/Size` + MD5 `/CheckSum`), `/Filespec`, and a `/Names`→
   * `/EmbeddedFiles` name-tree entry. `data` is the raw file content —
   * ≤25 MiB decoded. `name` is non-empty, ≤255 UTF-8 bytes, no control
   * characters, and must be unique (duplicates reject). `page`+`rect`
   * additionally place a `/FileAttachment` annotation (no appearance
   * stream is generated — viewers draw their default icon). Rejects on
   * encrypted documents. There is no remove op in this slice.
   */
  addFileAttachment(
    name: string,
    data: Uint8Array,
    options: {
      description?: string;
      page?: number;
      rect?: Rect;
    } = {},
  ) {
    return this.call<{ ok: boolean; name: string }>(OPS.addFileAttachment, {
      name,
      data_b64: bytesToBase64(data),
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.page === undefined ? {} : { page: options.page }),
      ...(options.rect === undefined ? {} : { rect: options.rect }),
    });
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
