import type { LayerAlphaOption, LayerBlendMode, LayerBlendSpace, LayerBlendValue } from '@nyc-tron/ui/components/forge/layers/layer-blend-model';
import type { PrismDocument } from '../../../packages/prism/src/index';
import { BLEND_MODES, type BlendMode } from '../../../packages/prism/src/canvas-types.ts';

/*
 * Engine side of NYC-Tron v1.0.0-rc.2 B-11 LayerBlendAndOpacity. Types come
 * from Tron's `layer-blend-model`, which has no imports, so this module and
 * its node test run without React Native.
 */

const titles: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'Color dodge', 'color-burn': 'Color burn', 'hard-light': 'Hard light', 'soft-light': 'Soft light',
  difference: 'Difference', exclusion: 'Exclusion', add: 'Add',
};

/** The 13 modes `setLayerBlend` accepts, in Prism's menu order. */
export const PRISM_BLEND_MODES: readonly LayerBlendMode[] = BLEND_MODES.map(id => ({ id, label: titles[id] }));

/**
 * Prism blends 8-bit RGBA as stored, with no linearisation and no ICC
 * handling, so the one space is encoded and named for the engine's channels.
 * There is no op to change it.
 */
export const PRISM_BLEND_SPACES = [
  { id: 'prism-rgba8', label: 'Prism RGBA', transfer: 'encoded', modeIds: BLEND_MODES },
] as const satisfies readonly LayerBlendSpace[];

/**
 * Prism stores and composites straight alpha and has no op that changes a
 * layer's alpha representation, so Premultiplied is not offered. With one
 * entry, LayerBlendAndOpacity shows it as text instead of a menu.
 */
export const PRISM_ALPHA_MODES = [
  { id: 'straight', label: 'Straight alpha' },
] as const satisfies readonly LayerAlphaOption[];

/** LayerBlendAndOpacity `value` for a Prism layer. */
export function prismLayerBlendValue(layer: { readonly opacity: number; readonly blend: BlendMode }): LayerBlendValue {
  return { mode: layer.blend, opacity: layer.opacity, spaceId: PRISM_BLEND_SPACES[0].id, alphaMode: PRISM_ALPHA_MODES[0].id };
}

const isBlendMode = (mode: string): mode is BlendMode => (BLEND_MODES as readonly string[]).includes(mode);

/**
 * LayerBlendAndOpacity `onCommit`. Validation runs now; the returned write is
 * one `setLayerBlend` or one `setLayerOpacity`, so each commit is one undo
 * step. Space and alpha commits cannot come from the one-entry catalogs above
 * and are refused before any engine call.
 * @throws {RangeError} An alpha, space, unknown mode or out-of-range opacity commit.
 */
export function prismLayerBlendWrite(
  document: Pick<PrismDocument, 'setLayerBlend' | 'setLayerOpacity'>,
  layerId: number,
  next: LayerBlendValue,
  kind: 'mode' | 'opacity' | 'space' | 'alpha',
): () => Promise<unknown> {
  switch (kind) {
    case 'mode': {
      const { mode } = next;
      if (!isBlendMode(mode)) throw new RangeError(`Prism has no "${mode}" blend mode.`);
      return () => document.setLayerBlend(layerId, mode);
    }
    case 'opacity': {
      const { opacity } = next;
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('Layer opacity must be 0..1');
      return () => document.setLayerOpacity(layerId, opacity);
    }
    case 'space':
      throw new RangeError('Prism blends in one compositing space.');
    case 'alpha':
      throw new RangeError('Prism layers use straight alpha only.');
  }
}
