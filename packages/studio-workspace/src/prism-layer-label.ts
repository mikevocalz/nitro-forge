import type { CanvasLayer } from './prism-canvas-model.ts';

/** Every kind of Prism layer has one name, used by the layer rows, the
 * toolbar, new layer names and the row icon. The engine's `rect` enum never
 * reaches the screen. */
export type PrismLayerKind = 'rectangle' | 'ellipse' | 'raster';

export const PRISM_LAYER_LABELS: Readonly<Record<PrismLayerKind, string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  raster: 'Raster',
};

/** Icon in the authored Forge set for each kind. */
export const PRISM_LAYER_ICONS: Readonly<Record<PrismLayerKind, string>> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  raster: 'image',
};

/** The kind of a layer, or of an engine shape enum (`rect`, `ellipse`). */
export function prismLayerKind(layer: Pick<CanvasLayer, 'content'> | 'rect' | 'ellipse'): PrismLayerKind {
  if (layer === 'rect') return 'rectangle';
  if (layer === 'ellipse') return 'ellipse';
  if (layer.content?.type !== 'shape') return 'raster';
  return layer.content.shape?.kind === 'ellipse' ? 'ellipse' : 'rectangle';
}

/** The kind's display name: "Rectangle", "Ellipse" or "Raster". */
export const prismLayerLabel = (layer: Parameters<typeof prismLayerKind>[0]): string => PRISM_LAYER_LABELS[prismLayerKind(layer)];
