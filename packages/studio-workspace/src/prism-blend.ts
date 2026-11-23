import type { LayerAlphaOption, LayerBlendMode, LayerBlendSpace, LayerBlendValue } from '@nyc-tron/ui/components/forge/layers/layer-blend-model';
import type { PrismLayer, PrismLayerCommand } from './prism-layers.ts';

export type { PrismLayer, PrismLayerCommand } from './prism-layers.ts';

/*
 * Prism adapter for NYC-Tron v1.0.0-rc.2 B-11 LayerBlendAndOpacity, shared by
 * every host that renders the Prism editor. Tron's `layer-blend-model` has no
 * imports, so this module and its node test run without React Native.
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
 * entry, LayerBlendAndOpacity shows it as text instead of a menu.
 */
export const PRISM_ALPHA_MODES = [
  { id: 'straight', label: 'Straight alpha' },
] as const satisfies readonly LayerAlphaOption[];

export const isPrismBlendMode = (mode: unknown): mode is PrismBlendModeId =>
  typeof mode === 'string' && (PRISM_BLEND_MODE_IDS as readonly string[]).includes(mode);

/**
 * LayerBlendAndOpacity `value` for a layer from Prism `describe`. A layer
 * without `blend` reads as `normal`, the engine default. A blend name Prism
 * does not list returns `undefined`, so the host can say so instead of
 * handing Tron a value its validation rejects.
 */
export function prismLayerBlendValue(layer: PrismLayer): LayerBlendValue | undefined {
  const mode = layer.blend ?? 'normal';
  if (!isPrismBlendMode(mode)) return undefined;
  return { mode, opacity: layer.opacity, spaceId: PRISM_BLEND_SPACES[0].id, alphaMode: PRISM_ALPHA_MODES[0].id };
}

/**
 * LayerBlendAndOpacity `onCommit` as one Prism command, or `undefined` when
 * the value did not change. Validation runs here, before any engine call:
 * each command is one `setLayerBlend` or one `setLayerOpacity`, so one undo
 * step. Space and alpha commits cannot come from the one-entry catalogs above
 * and are refused.
 * @throws {RangeError} An alpha, space or unknown-mode commit, an opacity
 * outside 0..1, or a layer id that is no longer in `layers`.
 */
export function prismBlendCommand(
  layers: readonly PrismLayer[],
  layerId: number,
  next: LayerBlendValue,
  kind: 'mode' | 'opacity' | 'space' | 'alpha',
): PrismLayerCommand | undefined {
  if (kind === 'space') throw new RangeError('Prism blends in one compositing space.');
  if (kind === 'alpha') throw new RangeError('Prism layers use straight alpha only.');
  const layer = layers.find(item => item.id === layerId);
  if (!layer) throw new RangeError(`No Prism layer ${layerId}`);
  if (kind === 'mode') {
    const { mode } = next;
    if (!isPrismBlendMode(mode)) throw new RangeError(`Prism has no "${mode}" blend mode.`);
    return mode === (layer.blend ?? 'normal') ? undefined : { op: 'setLayerBlend', payload: { id: layer.id, blend: mode }, label: 'Layer blend mode changed' };
  }
  const { opacity } = next;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError(`Opacity ${opacity} is outside 0..1`);
  return opacity === layer.opacity ? undefined : { op: 'setLayerOpacity', payload: { id: layer.id, opacity }, label: 'Layer opacity changed' };
}
