import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayerBlendAndOpacity, type LayerBlendAndOpacityProps } from '@nyc-tron/ui/components/forge/layers/LayerBlendAndOpacity';
import { CliHost } from '@nitro-forge/ignition/cli';
import { PrismDocument } from '../../../packages/prism/src/index';
import type { BlendMode } from '../../../packages/prism/src/canvas-types';
import { PRISM_ALPHA_MODES, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, prismLayerBlendValue, prismLayerBlendWrite } from '../src/prism-blend-wiring';

// F3 B-11 wiring. The markup checks render NYC-Tron's LayerBlendAndOpacity
// with the catalogs the Prism surface passes; the engine checks run the same
// writes against the real Rust engine through nf-cli
// (`cargo build --locked -p nf-cli` first).

const render = (props: Partial<LayerBlendAndOpacityProps>) => renderToStaticMarkup(createElement(LayerBlendAndOpacity, {
  scope: 'prism-1', layerId: '2', value: prismLayerBlendValue({ opacity: 1, blend: 'normal' }),
  modes: PRISM_BLEND_MODES, spaces: PRISM_BLEND_SPACES, onCommit: () => {}, ...props,
}));

describe('B-11 LayerBlendAndOpacity alpha catalog', () => {
  it('offers Straight alpha only, as text, with no alpha menu to open', () => {
    const html = render({ alphaModes: PRISM_ALPHA_MODES });
    expect(html).toContain('Straight alpha');
    expect(html).not.toContain('Premultiplied');
    expect(html).not.toMatch(/aria-label="Layer alpha representation"/);
    // The blend mode and compositing space menus are still there.
    expect(html).toMatch(/aria-label="Layer blend mode"/);
    expect(html).toMatch(/aria-label="Layer compositing space"/);
  });

  it('without the catalog Tron keeps its two-entry alpha menu, which Prism must not get', () => {
    expect(render({})).toMatch(/aria-label="Layer alpha representation"/);
  });
});

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe('B-11 LayerBlendAndOpacity wiring on Prism', () => {
  it('maps mode to setLayerBlend and opacity to setLayerOpacity, each one undo step', async () => {
    const doc = await PrismDocument.open(host, 8, 8);
    try {
      const id = (await doc.addRasterLayer('Paint')).data.layer_id;
      const read = async () => {
        const layer = (await doc.getLayer(id)).data as { opacity: number; blend: BlendMode };
        return prismLayerBlendValue(layer);
      };
      const start = await read();
      expect(start).toMatchObject({ mode: 'normal', opacity: 1, alphaMode: 'straight' });

      await prismLayerBlendWrite(doc, id, { ...start, mode: 'multiply' }, 'mode')();
      const blended = await read();
      expect(blended.mode).toBe('multiply');
      await prismLayerBlendWrite(doc, id, { ...blended, opacity: 0.25 }, 'opacity')();
      expect(await read()).toMatchObject({ mode: 'multiply', opacity: 0.25 });

      expect(await doc.undo()).toBe(true);
      expect(await read()).toMatchObject({ mode: 'multiply', opacity: 1 });
      expect(await doc.undo()).toBe(true);
      expect(await read()).toEqual(start);
      expect(await doc.redo()).toBe(true);
      expect((await read()).mode).toBe('multiply');
    } finally {
      await doc.close();
    }
  });
});
