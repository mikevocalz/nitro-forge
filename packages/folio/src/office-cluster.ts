import type { AnnotSubtype, FolioDocument, FolioCommentMetadata, FolioCommentEntry, Rect } from "./index";

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
/** The engine supports setAnnotationContents; the pinned comments control has no edit callback. */
export const FOLIO_DEFERRED_OPS = {
  /** K-04/K-06/K-18: page pixels for highlighting hits, placing marks and following the reader. */
  renderPage: "K-04",
  /** K-04 hit rectangles: `pageText` is lossy and carries no glyph positions. */
  textPositions: "K-04",
  /** K-06 freehand ink (`/Ink`). */
  inkAnnotation: "K-06",
} as const;
export type FolioDeferredOp = keyof typeof FOLIO_DEFERRED_OPS;

export type FolioOfficeDocument = Pick<FolioDocument,
  "pageCount" | "pageText" | "listAnnotations" | "addAnnotation" | "removeAnnotation" | "listCommentThreads" | "addAnnotationReply" | "setAnnotationReview" | "undo" | "redo">;

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
export const FOLIO_ANNOTATION_TOOLS = ["select", "note", "highlight", "underline", "strike", "rectangle", "ellipse"] as const;
export type FolioAnnotationTool = (typeof FOLIO_ANNOTATION_TOOLS)[number];

const SUBTYPE: Record<Exclude<FolioAnnotationTool, "select">, AnnotSubtype> = { note: "Text", highlight: "Highlight", underline: "Underline", strike: "StrikeOut", rectangle: "Square", ellipse: "Circle" };

/**
 * Saves what the active tool made on a page: a note, one axis-aligned horizontal markup quad or a bounded rectangle/ellipse.
 * `rect` is `[x, y, w, h]` in PDF user space, from the host's page view.
 */
export async function addFolioAnnotation(
  document: Pick<FolioDocument, "addAnnotation">, tool: string, page: number, rect: Rect, contents: string,
): Promise<number> {
  if (tool !== "note" && tool !== "highlight" && tool !== "underline" && tool !== "strike" && tool !== "rectangle" && tool !== "ellipse") throw new RangeError(`Folio cannot save a "${tool}" annotation (see FOLIO_DEFERRED_OPS)`);
  return requireData(await document.addAnnotation(page, rect, contents, SUBTYPE[tool]), "addAnnotation").annot_id;
}

/** `AnnotationToolbar` undo/redo backed by the document journal. */
export function bindFolioHistory(document: Pick<FolioDocument, "undo" | "redo">, onChanged: () => void) {
  return {
    onUndo: async () => { await document.undo(); onChanged(); },
    onRedo: async () => { await document.redo(); onChanged(); },
  };
}

/** Author/time come only from actual PDF metadata and an optional app formatter. */
export interface FolioThreadEntry { readonly id: string; readonly body: string; readonly author?: string; readonly modified?: string; readonly timeLabel?: string }
export interface FolioThread extends FolioThreadEntry {
  readonly page: number; readonly subtype: string; readonly rect: Rect | null;
  readonly replies: readonly FolioThreadEntry[]; readonly resolved?: boolean; readonly reviewState?: string;
}
export interface FolioCommentContext {
  readonly reviewAuthor: string;
  readonly metadata: () => FolioCommentMetadata | Promise<FolioCommentMetadata>;
  readonly isCurrent: () => boolean;
  /** Host generation/document lock; native operations do not provide expected-revision CAS. */
  readonly commit: (action: () => Promise<unknown>) => Promise<unknown>;
  readonly formatTime?: (pdfDate: string) => string;
}
function commentEntry(entry: FolioCommentEntry, page: number, context?: FolioCommentContext): FolioThreadEntry {
  return { id: `${page}:${entry.id}`, body: entry.contents,
    ...(entry.author === undefined ? {} : { author: entry.author }),
    ...(entry.modified === undefined ? {} : { modified: entry.modified }),
    ...(entry.modified === undefined || !context?.formatTime ? {} : { timeLabel: context.formatTime(entry.modified) }) };
}
export async function readFolioThreads(document: Pick<FolioDocument, "pageCount" | "listCommentThreads">, context?: FolioCommentContext): Promise<FolioThread[]> {
  if (context && !context.isCurrent()) throw new Error("The comment document changed");
  const pageCount = await readFolioPageCount(document);
  if (context && !context.isCurrent()) throw new Error("The comment document changed");
  const out: FolioThread[] = [];
  for (let page = 0; page < pageCount; page++) {
    if (context && !context.isCurrent()) throw new Error("The comment document changed");
    const { threads } = requireData(await document.listCommentThreads(page, context?.reviewAuthor), "listCommentThreads");
    if (context && !context.isCurrent()) throw new Error("The comment document changed");
    for (const thread of threads) out.push({ ...commentEntry(thread, page, context), page, subtype: thread.subtype, rect: thread.rect,
      replies: thread.replies.map(reply => commentEntry(reply, page, context)),
      ...(thread.resolved === undefined ? {} : { resolved: thread.resolved }), ...(thread.review_state === undefined ? {} : { reviewState: thread.review_state }) });
  }
  return out;
}

/** Splits a thread id from {@link readFolioThreads}. */
export function folioThreadRef(id: string): { page: number; annotation: number } {
  const m = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(id);
  if (!m) throw new RangeError(`"${id}" is not a Folio thread id`);
  return { page: Number(m[1]), annotation: Number(m[2]) };
}

/** Reply/review actions require explicit caller metadata, generation admission and write gate. */
export interface FolioCommentsBinding {
  readonly threads: readonly FolioThread[];
  readonly onDelete: (threadId: string) => Promise<void>;
  readonly onReply?: (threadId: string, body: string, mentions?: readonly string[]) => Promise<void>;
  readonly onResolvedChange?: (threadId: string, resolved: boolean) => Promise<void>;
}
export async function bindFolioComments(
  document: FolioOfficeDocument, onChanged: (next: FolioCommentsBinding) => void, context?: FolioCommentContext,
): Promise<FolioCommentsBinding> {
  if (context && (!context.reviewAuthor.trim() || context.reviewAuthor.length > 256)) throw new Error("A bounded review author is required");
  const threads = await readFolioThreads(document, context);
  const assertCurrent = () => { if (context && !context.isCurrent()) throw new Error("The comment document changed"); };
  const refresh = async () => { assertCurrent(); const next = await bindFolioComments(document, onChanged, context); assertCurrent(); onChanged(next); };
  const metadataWrite = async (id: string, action: (page: number, annotation: number, metadata: FolioCommentMetadata) => Promise<unknown>) => {
    if (!context) throw new Error("Comment author metadata and admission are required");
    assertCurrent(); const original = threads.find(thread => thread.id === id); if (!original) throw new Error("Comment not found");
    const supplied = await context.metadata();
    const metadata = { author: supplied.author, modified: supplied.modified }; assertCurrent();
    if (metadata.author !== context.reviewAuthor) throw new Error("Comment author changed");
    await context.commit(async () => {
      assertCurrent(); const current = await readFolioThreads(document, context); assertCurrent();
      if (JSON.stringify(current.find(thread => thread.id === id)) !== JSON.stringify(original)) throw new Error("The comment thread changed");
      const { page, annotation } = folioThreadRef(id); assertCurrent(); await action(page, annotation, metadata);
    });
    await refresh();
  };
  return {
    threads,
    onDelete: async id => {
      const { page, annotation } = folioThreadRef(id); assertCurrent();
      const write = async () => { assertCurrent(); await document.removeAnnotation(page, annotation); };
      if (context) await context.commit(write); else await write();
      await refresh();
    },
    ...(context ? {
      onReply: async (id: string, body: string, mentions?: readonly string[]) => {
        if (mentions?.length) throw new Error("PDF comment mentions are not supported");
        await metadataWrite(id, (page, annotation, metadata) => document.addAnnotationReply(page, annotation, body, metadata));
      },
      onResolvedChange: async (id: string, resolved: boolean) => metadataWrite(id, (page, annotation, metadata) => document.setAnnotationReview(page, annotation, resolved, metadata)),
    } : {}),
  };
}
