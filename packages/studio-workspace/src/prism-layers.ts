import type { LayerRow } from '@nyc-tron/ui/components/forge/layers/layer-model';
import type { CanvasLayer } from './prism-canvas-model.ts';
import { prismLayerLabel } from './prism-layer-label.ts';

/**
 * Prism engine adapter for NYC-Tron's `LayerStack`.
 *
 * Prism stores layers bottom to top (engine index 0 is the bottom layer);
 * `LayerStack` lists them top to bottom (row index 0 is the topmost layer).
 * Every function here converts between the two, so no index arithmetic lives
 * in the editor. Each command is one engine operation and so one undo step.
 */

/** A Prism layer as the editor reads it from the engine's `describe` state. */
export type PrismLayer = CanvasLayer & { name: string };

/**
 * One engine operation produced from a {@linkcode LayerStack} callback. The
 * editor runs it through its single command path and shows `label` once the
 * engine accepts it.
 */
export type PrismLayerCommand =
  | { op: 'moveLayer'; payload: { id: number; to_index: number }; label: string }
  | { op: 'setLayerOpacity'; payload: { id: number; opacity: number }; label: string }
  | { op: 'setLayerVisible'; payload: { id: number; visible: boolean }; label: string }
  | { op: 'renameLayer'; payload: { id: number; name: string }; label: string };

/** Row id for an engine layer id. */
export const prismLayerRowId = (id: number): string => String(id);

/**
 * The engine layer behind a row id.
 * @throws RangeError when no layer in `layers` has that id, which means the
 * callback came from rows the document has since replaced.
 */
function layerForRow(layers: readonly PrismLayer[], rowId: string): { layer: PrismLayer; index: number } {
  const index = layers.findIndex(layer => prismLayerRowId(layer.id) === rowId);
  const layer = layers[index];
  if (!layer) throw new RangeError(`No Prism layer for row ${rowId}`);
  return { layer, index };
}

/** Rows for `LayerStack`, topmost layer first. A blank engine name reads as its kind and id. */
export function prismLayerRows(layers: readonly PrismLayer[]): LayerRow[] {
  return layers.map(layer => ({
    id: prismLayerRowId(layer.id),
    name: layer.name.trim() ? layer.name : `${prismLayerLabel(layer)} ${layer.id}`,
    visible: layer.visible,
    opacity: Math.min(1, Math.max(0, Number.isFinite(layer.opacity) ? layer.opacity : 1)),
    kind: layer.content?.type === 'shape' ? 'vector' as const : 'raster' as const,
  })).reverse();
}

/** The engine layer id for a selected row id, or `undefined` when no row is selected. */
export function prismSelectedRowId(selectedId: number | null): string | undefined {
  return selectedId === null ? undefined : prismLayerRowId(selectedId);
}

/**
 * `moveLayer` for a row landing on `toIndex` (0 = top), or `undefined` when
 * the layer is already there.
 */
export function prismMoveCommand(layers: readonly PrismLayer[], rowId: string, toIndex: number): PrismLayerCommand | undefined {
  const { layer, index } = layerForRow(layers, rowId);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= layers.length) throw new RangeError(`Row index ${toIndex} is outside 0..${layers.length - 1}`);
  const engineIndex = layers.length - 1 - toIndex;
  return engineIndex === index ? undefined : { op: 'moveLayer', payload: { id: layer.id, to_index: engineIndex }, label: 'Layer reordered' };
}

/**
 * `setLayerOpacity` for one released opacity gesture, or `undefined` when the
 * value did not change. `LayerStack` reports each completed drag once.
 */
export function prismOpacityCommand(layers: readonly PrismLayer[], rowId: string, opacity: number): PrismLayerCommand | undefined {
  const { layer } = layerForRow(layers, rowId);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError(`Opacity ${opacity} is outside 0..1`);
  return opacity === layer.opacity ? undefined : { op: 'setLayerOpacity', payload: { id: layer.id, opacity }, label: 'Layer opacity changed' };
}

/** `setLayerVisible` that flips the row's visibility. */
export function prismVisibilityCommand(layers: readonly PrismLayer[], rowId: string): PrismLayerCommand {
  const { layer } = layerForRow(layers, rowId);
  return { op: 'setLayerVisible', payload: { id: layer.id, visible: !layer.visible }, label: layer.visible ? 'Layer hidden' : 'Layer shown' };
}

/** `renameLayer` with the trimmed name `LayerStack` submitted, or `undefined` when it is unchanged. */
export function prismRenameCommand(layers: readonly PrismLayer[], rowId: string, name: string): PrismLayerCommand | undefined {
  const { layer } = layerForRow(layers, rowId);
  const next = name.trim();
  if (!next) throw new RangeError('A layer name needs at least one character');
  return next === layer.name ? undefined : { op: 'renameLayer', payload: { id: layer.id, name: next }, label: 'Layer renamed' };
}
