export type MeasuredLayer = { id: number; x: number; y: number; width: number; height: number };
/** Engine layers are bottom-to-top; measured rows are displayed top-to-bottom. */
export function layerDropIndex(rows: readonly MeasuredLayer[], draggedId: number, point: { x: number; y: number }, viewport: { x: number; y: number; width: number; height: number }): number | null {
  if (!rows.some(row => row.id === draggedId) || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < viewport.x || point.x > viewport.x + viewport.width || point.y < viewport.y || point.y > viewport.y + viewport.height) return null;
  const remaining = rows.filter(row => row.id !== draggedId);
  const visualIndex = remaining.filter(row => point.y >= row.y + row.height / 2).length;
  return rows.length - 1 - visualIndex;
}

export type LayerMeasurements = { rows: MeasuredLayer[]; viewport: { x: number; y: number; width: number; height: number } | null };
/** A quick release can precede native measurement callbacks. Resolve the same
 * transaction after measurement, and reject cancellation or a replaced document. */
export async function awaitLayerDrop(ready: Promise<LayerMeasurements>, draggedId: number, point: { x: number; y: number }, isCurrent: () => boolean): Promise<number | null> {
  const measured = await ready;
  return isCurrent() && measured.viewport ? layerDropIndex(measured.rows, draggedId, point, measured.viewport) : null;
}
