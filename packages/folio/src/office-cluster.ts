import type { AnnotSubtype, FolioDocument, Rect } from "./index";

/**
 * Engine side of NYC-Tron's PDF controls (Forge roster K-04
 * TextSearchResults, K-06 AnnotationToolbar, K-07 CommentsThreadPanel, K-18
 * PDFReadAloudTransport). No React and no `@nyc-tron/*` import: plain data
 * and callbacks named after the NYC-Tron props.
 *
 * Folio has no page render op. Anything that needs pixels or glyph positions
 * (drawing a search hit or an annotation on the page, following the reading
 * position on screen) is deferred on `renderPage` / `textPositions` below;
 * the list, toolbar, thread and transport parts work from text and
 * annotation data alone.
 */

/**
 * Engine operations the PDF controls can express but Folio does not have.
 * Each is a DEFER: the matching NYC-Tron prop is left out or the tool is not
 * listed.
 */
export const FOLIO_DEFERRED_OPS = {
  /** K-04/K-06/K-18: page pixels for highlighting hits, placing marks and following the reader. */
  renderPage: "K-04",
  /** K-04 hit rectangles: `pageText` is lossy and carries no glyph positions. */
  textPositions: "K-04",
  /** K-06 underline markup (`/Subtype /Underline`): `addAnnotation` writes Text and Highlight only. */
  underlineAnnotation: "K-06",
  /** K-06 strikethrough markup (`/StrikeOut`). */
  strikeOutAnnotation: "K-06",
  /** K-06 freehand ink (`/Ink`). */
  inkAnnotation: "K-06",
  /** K-06 rectangle and ellipse (`/Square`, `/Circle`). */
  shapeAnnotations: "K-06",
  /** K-07 author and date (`/T`, `/M`): `listAnnotations` reports id, subtype, rect and contents. */
  annotationAuthor: "K-07",
  /** K-07 replies (`/IRT` reply annotations). */
  replyAnnotation: "K-07",
  /** K-07 resolve and reopen (`/State`, `/StateModel Review`). */
  setAnnotationState: "K-07",
  /** K-07 edit a comment's text in place. */
  setAnnotationContents: "K-07",
} as const;
export type FolioDeferredOp = keyof typeof FOLIO_DEFERRED_OPS;

export type FolioOfficeDocument = Pick<FolioDocument,
  "pageCount" | "pageText" | "listAnnotations" | "addAnnotation" | "removeAnnotation" | "undo" | "redo">;

function requireData<T>(response: { data?: T }, op: string): T {
  if (response.data === undefined || response.data === null) throw new Error(`Folio ${op} returned no data`);
  return response.data;
}

/** Page count from `pageCount`. */
export async function readFolioPageCount(document: Pick<FolioDocument, "pageCount">): Promise<number> {
  const n = requireData(await document.pageCount(), "pageCount").pages;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Folio returned an invalid page count");
  return n;
}

/**
 * Page texts in search order: from `fromPage`, wrapping round, so the
 * first hits near the reader arrive first (K-04). Feed each page to
 * NYC-Tron's `findInPageText` and `insertPageHits`. Stops between pages
 * when `signal` aborts. A page whose text cannot be read rejects; the search
 * list then shows its read error rather than "no matches".
 */
export async function* folioSearchPages(
  document: Pick<FolioDocument, "pageCount" | "pageText">, fromPage: number, signal?: AbortSignal,
): AsyncGenerator<{ page: number; text: string; searched: number; pageCount: number }> {
  const pageCount = await readFolioPageCount(document);
  if (pageCount === 0) return;
  const start = ((Math.trunc(fromPage) % pageCount) + pageCount) % pageCount;
  for (let k = 0; k < pageCount; k++) {
    if (signal?.aborted) return;
    const page = (start + k) % pageCount;
    const text = requireData(await document.pageText(page), "pageText").text;
    yield { page, text, searched: k + 1, pageCount };
  }
}

/** Pages as read-aloud input (`readAloudSentences` takes `{block, text}`; block = page index), skipping blank pages. */
export async function readFolioReadAloudBlocks(document: Pick<FolioDocument, "pageCount" | "pageText">): Promise<{ block: number; text: string }[]> {
  const out: { block: number; text: string }[] = [];
  for await (const p of folioSearchPages(document, 0)) if (p.text.trim()) out.push({ block: p.page, text: p.text });
  return out;
}

/** Tools Folio can save, for `AnnotationToolbar.tools`. */
export const FOLIO_ANNOTATION_TOOLS = ["select", "note", "highlight"] as const;
export type FolioAnnotationTool = (typeof FOLIO_ANNOTATION_TOOLS)[number];

const SUBTYPE: Record<Exclude<FolioAnnotationTool, "select">, AnnotSubtype> = { note: "Text", highlight: "Highlight" };

/**
 * Saves what the active tool made on a page: a note (`Text`) or a highlight.
 * `rect` is `[x, y, w, h]` in PDF user space, from the host's page view.
 */
export async function addFolioAnnotation(
  document: Pick<FolioDocument, "addAnnotation">, tool: string, page: number, rect: Rect, contents: string,
): Promise<number> {
  if (tool !== "note" && tool !== "highlight") throw new RangeError(`Folio cannot save a "${tool}" annotation (see FOLIO_DEFERRED_OPS)`);
  return requireData(await document.addAnnotation(page, rect, contents, SUBTYPE[tool]), "addAnnotation").annot_id;
}

/** `AnnotationToolbar` undo/redo backed by the document journal. */
export function bindFolioHistory(document: Pick<FolioDocument, "undo" | "redo">, onChanged: () => void) {
  return {
    onUndo: async () => { await document.undo(); onChanged(); },
    onRedo: async () => { await document.redo(); onChanged(); },
  };
}

/** A thread as NYC-Tron `CommentThread` takes it. Folio threads have no author, time, replies or state. */
export interface FolioThread {
  /** `<page>:<annotation object id>`. */
  readonly id: string;
  readonly page: number;
  readonly body: string;
  readonly subtype: string;
  readonly rect: Rect | null;
  readonly replies: readonly never[];
}

/** Every annotation in the document as a one-comment thread, in page order. */
export async function readFolioThreads(document: Pick<FolioDocument, "pageCount" | "listAnnotations">): Promise<FolioThread[]> {
  const pageCount = await readFolioPageCount(document);
  const out: FolioThread[] = [];
  for (let page = 0; page < pageCount; page++) {
    const { annots } = requireData(await document.listAnnotations(page), "listAnnotations");
    if (!Array.isArray(annots)) throw new Error("Folio returned invalid annotations");
    for (const a of annots) {
      if (!Number.isSafeInteger(a.id)) throw new Error("Folio returned a malformed annotation");
      out.push({ id: `${page}:${a.id}`, page, body: typeof a.contents === "string" ? a.contents : "", subtype: a.subtype,
        rect: Array.isArray(a.rect) ? a.rect : null, replies: [] });
    }
  }
  return out;
}

/** Splits a thread id from {@link readFolioThreads}. */
export function folioThreadRef(id: string): { page: number; annotation: number } {
  const m = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(id);
  if (!m) throw new RangeError(`"${id}" is not a Folio thread id`);
  return { page: Number(m[1]), annotation: Number(m[2]) };
}

/** `CommentsThreadPanel` props Folio can back: threads and delete. Reply and resolve are deferred. */
export interface FolioCommentsBinding {
  readonly threads: readonly FolioThread[];
  readonly onDelete: (threadId: string) => Promise<void>;
}

/** Binds the comments panel; delete goes through `removeAnnotation` and re-reads. */
export async function bindFolioComments(
  document: FolioOfficeDocument, onChanged: (next: FolioCommentsBinding) => void,
): Promise<FolioCommentsBinding> {
  const threads = await readFolioThreads(document);
  return {
    threads,
    onDelete: async id => {
      const { page, annotation } = folioThreadRef(id);
      await document.removeAnnotation(page, annotation);
      onChanged(await bindFolioComments(document, onChanged));
    },
  };
}
