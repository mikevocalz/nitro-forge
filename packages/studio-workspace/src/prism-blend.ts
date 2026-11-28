import { layerOpacityFromPercent, validateLayerBlend, type LayerAlphaOption, type LayerBlendMode, type LayerBlendSpace, type LayerBlendValue } from '@nitro-forge/editor-controls/layers/layer-blend-model';
import type { CommandMenuItem } from '@nyc-tron/ui/components/shell/MenuButton';
import type { PrismLayer, PrismLayerCommand } from './prism-layers.ts';

export type { PrismLayer, PrismLayerCommand } from './prism-layers.ts';

/*
 * Prism adapter for the NYC-Tron v1.0.0-rc.2 B-11 layer blend model, shared by
 * every host that renders the Prism editor. Decision D7: the Layers panel
 * shows the blend mode in Tron's MenuButton and the Straight alpha line as
 * text, both from these catalogs, and keeps Forge's configured
 * PrecisionScrubber for opacity. `layer-blend-model` has no imports and
 * MenuButton is imported for its item type only, so this module and its node
 * test run without React Native.
 */

/**
 * The 13 modes Prism `setLayerBlend` accepts, in its menu order. This package
 * talks to Prism through op names only, so the list is repeated here;
 * apps/studio-preview/tests/prism-blend.e2e.test.ts checks it against
 * `BLEND_MODES` in packages/prism.
 */
export const PRISM_BLEND_MODE_IDS = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'add',
] as const;
export type PrismBlendModeId = (typeof PRISM_BLEND_MODE_IDS)[number];

const titles: Record<PrismBlendModeId, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'Color dodge', 'color-burn': 'Color burn', 'hard-light': 'Hard light', 'soft-light': 'Soft light',
  difference: 'Difference', exclusion: 'Exclusion', add: 'Add',
};

export const PRISM_BLEND_MODES: readonly LayerBlendMode[] = PRISM_BLEND_MODE_IDS.map(id => ({ id, label: titles[id] }));

/**
 * Prism blends 8-bit RGBA as stored, with no linearisation and no ICC
 * handling, so the one space is encoded and named for the engine's channels.
 * There is no op to change it.
 */
export const PRISM_BLEND_SPACES = [
  { id: 'prism-rgba8', label: 'Prism RGBA', transfer: 'encoded', modeIds: PRISM_BLEND_MODE_IDS },
] as const satisfies readonly LayerBlendSpace[];

/**
 * Prism stores and composites straight alpha and has no op that changes a
 * layer's alpha representation, so Premultiplied is not offered. With one
 * entry the Layers panel shows it as text, not a menu.
 */
export const PRISM_ALPHA_MODES = [
  { id: 'straight', label: 'Straight alpha' },
] as const satisfies readonly LayerAlphaOption[];

/**
 * The Layers panel opacity scrubber, as before B-11: whole percent steps, so
 * each "−"/"+" press, arrow key or screen-reader increment moves 1 %.
 */
export const PRISM_OPACITY_SCRUBBER = {
  label: 'Layer opacity', min: 0, max: 100, step: 1, unit: '%', detents: [0, 25, 50, 75, 100],
} as const satisfies { label: string; min: number; max: number; step: number; unit: string; detents: readonly number[] };

export const isPrismBlendMode = (mode: unknown): mode is PrismBlendModeId =>
  typeof mode === 'string' && (PRISM_BLEND_MODE_IDS as readonly string[]).includes(mode);

const blendValue = (mode: PrismBlendModeId, opacity: number): LayerBlendValue => {
  const value: LayerBlendValue = { mode, opacity, spaceId: PRISM_BLEND_SPACES[0].id, alphaMode: PRISM_ALPHA_MODES[0].id };
  validateLayerBlend(value, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, PRISM_ALPHA_MODES);
  return value;
};

/**
 * The layer's blend value in Tron's model, checked by Tron's
 * `validateLayerBlend` against the Prism catalogs. A layer without `blend`
 * reads as `normal`, the engine default. A blend name Prism does not list
 * returns `undefined`, so the host can say so.
 * @throws {RangeError} The layer's opacity is outside 0..1.
 */
export function prismLayerBlendValue(layer: PrismLayer): LayerBlendValue | undefined {
  const mode = layer.blend ?? 'normal';
  return isPrismBlendMode(mode) ? blendValue(mode, layer.opacity) : undefined;
}

/**
 * Items for the blend mode MenuButton, built as Tron's LayerBlendAndOpacity
 * builds its own: a mode is disabled when it has an unavailable reason or the
 * compositing space does not list it.
 */
export function prismBlendMenuItems(): CommandMenuItem[] {
  const space = PRISM_BLEND_SPACES[0];
  return PRISM_BLEND_MODES.map(mode => ({
    id: mode.id,
    label: mode.label,
    ...(mode.unavailableReason ? { description: mode.unavailableReason } : {}),
    disabled: !!mode.unavailableReason || !(space.modeIds as readonly string[]).includes(mode.id),
  }));
}

/** One Layers panel commit: a blend mode menu choice or a released opacity percent. */
export type PrismBlendChange =
  | { readonly kind: 'mode'; readonly mode: string }
  | { readonly kind: 'opacity'; readonly percent: number };

/**
 * A Layers panel commit as one Prism command, or `undefined` when the value
 * did not change. Validation runs here, before any engine call: each command
 * is one `setLayerBlend` or one `setLayerOpacity`, so one undo step. A mode
 * goes through Tron's `validateLayerBlend`; a percent through Tron's
 * `layerOpacityFromPercent`.
 * @throws {RangeError} An unknown mode, a percent outside 0..100, or a layer
 * id that is no longer in `layers`.
 */
export function prismBlendCommand(
  layers: readonly PrismLayer[],
  layerId: number,
  change: PrismBlendChange,
): PrismLayerCommand | undefined {
  const layer = layers.find(item => item.id === layerId);
  if (!layer) throw new RangeError(`No Prism layer ${layerId}`);
  if (change.kind === 'mode') {
    const { mode } = change;
    if (!isPrismBlendMode(mode)) throw new RangeError(`Prism has no "${mode}" blend mode.`);
    blendValue(mode, layer.opacity);
    return mode === (layer.blend ?? 'normal') ? undefined : { op: 'setLayerBlend', payload: { id: layer.id, blend: mode }, label: 'Layer blend mode changed' };
  }
  const opacity = layerOpacityFromPercent(change.percent);
  return opacity === layer.opacity ? undefined : { op: 'setLayerOpacity', payload: { id: layer.id, opacity }, label: 'Layer opacity changed' };
}
