import type { BoardRecord, Diff, ShapeRecord, Snapshot } from "@quickdrawjs/core";
import type { WhiteboardRenderer } from "../specs/WhiteboardRenderer.nitro";

/**
 * Builds the {@linkcode WhiteboardRenderer} wire JSON from QuickDraw
 * snapshots and diffs.
 */
export interface InkOutlineEncoder {
  /** Snapshot JSON with `inkOutline` attached to every pressure-ink `draw` record. */
  encodeSnapshot(snapshot: Snapshot): string;
  /**
   * Diff JSON with `inkOutline` attached. The first element of each
   * `updated` pair and every `removed` value are sent as `null`; the
   * renderer reads only `added`, the second `updated` element and `removed` keys.
   */
  encodeDiff(diff: Diff): string;
}

type EncodedRecord = BoardRecord | (ShapeRecord & { inkOutline: number[] });

/**
 * Attaches ink outlines to records on their way to the renderer. Outlines
 * are cached per `props` object: QuickDraw replaces `props` on every edit,
 * so a cache hit is always the current outline.
 */
export function createInkOutlineEncoder(
  getInkOutline: (shape: ShapeRecord) => number[] | undefined,
): InkOutlineEncoder {
  const outlines = new WeakMap<object, number[] | null>();

  const encodeRecord = (record: BoardRecord): EncodedRecord => {
    if (record.typeName !== "shape" || record.type !== "draw") return record;
    let outline = outlines.get(record.props);
    if (outline === undefined) {
      outline = getInkOutline(record) ?? null;
      outlines.set(record.props, outline);
    }
    if (outline === null) return record;
    return { ...record, inkOutline: outline };
  };

  return {
    encodeSnapshot(snapshot) {
      const store: Record<string, EncodedRecord> = {};
      for (const [id, record] of Object.entries(snapshot.document.store)) store[id] = encodeRecord(record);
      return JSON.stringify({ document: { store } });
    },
    encodeDiff(diff) {
      const added: Record<string, EncodedRecord> = {};
      for (const [id, record] of Object.entries(diff.added)) added[id] = encodeRecord(record);
      const updated: Record<string, [null, EncodedRecord]> = {};
      for (const [id, pair] of Object.entries(diff.updated)) updated[id] = [null, encodeRecord(pair[1])];
      const removed: Record<string, null> = {};
      for (const id of Object.keys(diff.removed)) removed[id] = null;
      return JSON.stringify({ added, updated, removed });
    },
  };
}
