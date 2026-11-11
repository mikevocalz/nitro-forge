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
  redactRect: "redactRect",
  comparePdf: "comparePdf",
  insertPageImage: "insertPageImage",
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
/** Image input formats admitted by `insertPageImage` — see docs/ENGINE_OPS.md. */
export type FolioImageFormat = "jpeg" | "png" | "raw";
/**
 * Image payload for `insertPageImage`. `jpeg`/`png` carry an encoded file
 * (jpeg is embedded as DCTDecode passthrough — only the SOF header is
 * read; png is decoded to samples: 8-bit, non-interlaced, gray/RGB with
 * alpha discarded). `raw` carries unfiltered 8-bpc interleaved samples
 * and requires `width`, `height` and `colorSpace`.
 */
export interface FolioPageImage {
  format: FolioImageFormat;
  data: Uint8Array;
  /** `raw` only: pixel width. */
  width?: number;
  /** `raw` only: pixel height. */
  height?: number;
  /** `raw` only: sample layout — 3 bytes/px RGB or 1 byte/px gray. */
  colorSpace?: "DeviceRGB" | "DeviceGray";
}
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
 * `null` when absent — never the possibly-compressed `/Length`. It is a
 * declared value and can differ from `getAttachment`'s actual decoded
 * length on PDFs whose `/Params` lies; `name` is `""` for name-tree
 * keys that are not PDF strings.
 */
export interface FolioAttachmentInfo {
  name: string;
  size: number | null;
  description: string | null;
}

/**
 * Why an image XObject intersecting the redaction rect was retained, keyed
 * by PDF object number (string). `not_drawn` = resource entry exists but
 * no reachable `Do` places it; `extends_outside_rect` = at least one
 * placement is not fully contained; `drawn_inside_form` = placed through
 * a form XObject (nested resources are never rewritten); `shared_content_stream`
 * = the `Do` lives in a content stream shared with another page;
 * `analysis_incomplete` = the bounded content scan could not prove every
 * placement (budget/depth/cycle cap hit).
 */
export type FolioRedactRetainedReason =
  | "not_drawn"
  | "extends_outside_rect"
  | "drawn_inside_form"
  | "shared_content_stream"
  | "inline_images_in_stream"
  | "analysis_incomplete";

/**
 * Honest report from `redactRect`. `removed`/`retained` counts and id
 * lists are exact for what the engine provably deleted; every list is
 * capped (with `*_truncated` flags) — totals in the counts are NOT
 * capped. `image_draws_removed` counts images whose `Do` operations were
 * stripped while the object stayed reachable through a shared resource
 * chain. `metadata` maps scrubbed metadata kinds to removal counts —
 * coverage is standard locations only (`/PieceInfo` and XMP `/Metadata`
 * on every page and the catalog, trailer `/Info`); XMP under
 * non-standard keys survives. `retained.inline_images` counts inline
 * `BI`…`EI` images plus inline stream XObjects seen during the scan;
 * content streams containing them are never re-encoded, so image draws
 * inside them are retained as `inline_images_in_stream`. Widget /
 * form-field annotations intersecting the rect reject the whole op as
 * Unsupported (intentional — a partial field removal would corrupt the
 * `/AcroForm` graph). `content_note` is the honesty contract: text and
 * vector content under the rect is NEVER removed (no glyph positions in
 * lopdf) and remains byte-identical — hosts must verify redaction
 * visually.
 */
export interface FolioRedactReport {
  ok: boolean;
  removed: {
    annotations: number;
    annotation_ids: number[];
    annotation_ids_truncated: boolean;
    images: number;
    image_ids: number[];
    image_ids_truncated: boolean;
    image_draws_removed: number;
    image_draw_ids: number[];
    image_draw_ids_truncated: boolean;
    metadata: Record<string, number>;
  };
  retained: {
    annotations: number;
    annotation_ids: number[];
    annotation_ids_truncated: boolean;
    images: number;
    image_reasons: Record<string, FolioRedactRetainedReason | string>;
    image_reasons_truncated: boolean;
    inline_images: number;
  };
  content_note: string;
}

/** Per-page structural difference entry from `comparePdf`. */
export interface FolioComparePageChange {
  index: number;
  fields: ("mediabox" | "rotate" | "annotations" | "has_contents")[];
}

/**
 * One annotation in a `comparePdf` multiset diff. `rect` is
 * `[x, y, w, h]` derived from the PDF `/Rect`; `contents_md5` hashes the
 * decoded `/Contents` (raw text is never compared or returned). The
 * signature is deliberately narrow — subtype + rect + contents hash
 * only; author, color, flags, QuadPoints, IRT links and every other
 * annotation key are ignored. `unreadable: true` marks entries whose
 * dictionary could not be resolved — they still participate in the diff.
 */
export interface FolioCompareAnnotEntry {
  page: number;
  subtype?: string | null;
  rect?: [number, number, number, number] | null;
  contents_md5?: string | null;
  unreadable?: boolean;
}

/** Form-field diff entry: the `listFormFields` projection minus `annot`. */
export type FolioCompareField = Omit<FolioFormField, "annot">;

/** Outline diff entry: the `listOutlines` node minus `id`. */
export interface FolioCompareOutlineItem {
  title: string;
  page: number | null;
  dest?: string | unknown[];
  children: FolioCompareOutlineItem[];
}

/** Signature diff entry: the `listSignatures` row minus `annot`. */
export type FolioCompareSignature = Omit<FolioSignature, "annot">;

/**
 * Structural diff of this document against another PDF, from
 * `comparePdf`. `structural_identical` compares only the modeled
 * projections (page geometry/rotation/annotation multiset/contents
 * presence, form fields, outlines, attachments, signature fields) — it
 * is NOT byte or semantic equality; unmodeled PDF features are outside
 * the diff, and `text.differing_pages` is a lossy hint that does not
 * affect `structural_identical`. Signature rows compare `/ByteRange`
 * offsets verbatim — they are file-position dependent, so identical
 * content serialized differently can produce conservative false diffs.
 * Every `*_added`/`*_removed` list is capped at 256 entries with
 * `*_total` counts and `*_truncated`-style honesty via the totals; page
 * index lists carry `*_total` too.
 */
export interface FolioCompareResult {
  pages: { current: number; other: number };
  structural_identical: boolean;
  differences: {
    only_in_current: number[];
    only_in_current_total: number;
    only_in_current_truncated: boolean;
    only_in_other: number[];
    only_in_other_total: number;
    only_in_other_truncated: boolean;
    page_changes: FolioComparePageChange[];
    page_changes_total: number;
    page_changes_truncated: boolean;
    annotations_added: FolioCompareAnnotEntry[];
    annotations_added_total: number;
    annotations_removed: FolioCompareAnnotEntry[];
    annotations_removed_total: number;
    form_fields_added: FolioCompareField[];
    form_fields_added_total: number;
    form_fields_removed: FolioCompareField[];
    form_fields_removed_total: number;
    outlines_added: FolioCompareOutlineItem[];
    outlines_added_total: number;
    outlines_removed: FolioCompareOutlineItem[];
    outlines_removed_total: number;
    attachments_added: FolioAttachmentInfo[];
    attachments_added_total: number;
    attachments_removed: FolioAttachmentInfo[];
    attachments_removed_total: number;
    signatures_added: FolioCompareSignature[];
    signatures_added_total: number;
    signatures_removed: FolioCompareSignature[];
    signatures_removed_total: number;
  };
  text: {
    differing_pages: number[];
    differing_pages_total: number;
    differing_pages_truncated: boolean;
    unknown_pages: number[];
    unknown_pages_total: number;
    unknown_pages_truncated: boolean;
    note: string;
  };
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

  /** Open an existing PDF file's bytes. `password` is the user password — it decrypts during load when the document is encrypted (ignored otherwise; owner-only passwords still need the user password). */
  static async openPdf(
    host: EngineHost,
    pdfBytes: Uint8Array,
    password?: string,
  ): Promise<FolioDocument> {
    const doc = await DocumentHandle.openInitialized(host, "folio",
      (document) => document.apply(OPS.open, {
        bytes_b64: bytesToBase64(pdfBytes),
        ...(password === undefined ? {} : { password }),
      }));
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
  /**
   * Place an image on 0-based `page`, stretched to `rect` (`[x, y, w, h]`,
   * PDF user space — no aspect preservation; the caller computes the
   * rect). The engine appends a new content stream and never rewrites
   * existing page content. `image.format` selects the honest contract:
   * `"jpeg"` embeds the file verbatim as DCTDecode (8-bit gray/RGB only —
   * the engine reads the SOF header, never decodes pixels);
   * `"png"` decodes 8-bit non-interlaced gray/RGB(/alpha-discarded)
   * samples; `"raw"` takes unfiltered 8-bpc samples and requires
   * `width`/`height`/`colorSpace`. Rejects on encrypted documents.
   */
  insertPageImage(page: number, rect: Rect, image: FolioPageImage) {
    return this.call<{
      ok: boolean;
      name: string;
      width: number;
      height: number;
      color_space: string;
      format: FolioImageFormat;
    }>(OPS.insertPageImage, {
      page,
      rect,
      format: image.format,
      image_b64: bytesToBase64(image.data),
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
      ...(image.colorSpace === undefined ? {} : { color_space: image.colorSpace }),
    });
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
   * Extract one attachment's decoded bytes by name. `size` is the actual
   * decoded length; the ≤64 MiB engine cap applies to the decoded result
   * but lopdf materializes decompression unboundedly first (pre-existing
   * lopdf limitation — bound input PDF sizes). Resolves `{name, size}`
   * plus `bytes_b64` in `data`.
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
  /**
   * Structural redaction of `rect` (`[x, y, w, h]`, PDF user space,
   * bottom-left origin) on 0-based `page`. Removes annotations whose
   * `/Rect` intersects the region (including comment reply/pop-up
   * cascades) and image XObjects every placement of which is fully
   * contained; partially overlapping images, form-nested images, images
   * on shared content streams and shared resource chains are RETAINED
   * and reported with reasons in `FolioRedactReport`. Also scrubs
   * `/PieceInfo`, XMP `/Metadata` streams and the trailer `/Info`
   * dictionary document-wide.
   *
   * HONESTY CONTRACT — read before relying on this for compliance:
   * text and vector content under the rect is NEVER removed. lopdf has
   * no glyph-position API, so `Tj`/`TJ` strings and path painting cannot
   * be located; they remain byte-identical. This op is structural
   * cleanup, not a provable redaction — render and verify visually
   * (the deferred pdfium service) or reject the workflow. Undo
   * restores the exact pre-redaction document, so redacted content is
   * recoverable in-engine; treat this as non-security-boundary editing.
   * Rejects on encrypted documents (decrypt first) and on hostile
   * input exceeding the engine's work caps.
   */
  redactRect(page: number, rect: Rect) {
    return this.call<FolioRedactReport>(OPS.redactRect, { page, rect });
  }
  /**
   * Structural comparison of this document against another PDF's bytes.
   * Read-only and eventless; the other document is parsed but never
   * installed. Diffs page count/geometry/rotation/annotation multisets/
   * content presence, form fields, outlines, attachments and signature
   * fields — see `FolioCompareResult` for exactly what is and is not
   * compared. Text comparison reuses the lossy `pageText` extraction
   * and is reported separately as `text.differing_pages` (a hint, not
   * proof, and it does NOT affect `structural_identical`). Both
   * documents must be unencrypted. Rejects inputs over the engine's
   * work caps (10 000 pages, 100 000 annotations/objects).
   */
  comparePdf(otherPdf: Uint8Array) {
    return this.call<FolioCompareResult>(OPS.comparePdf, {
      bytes_b64: bytesToBase64(otherPdf),
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
