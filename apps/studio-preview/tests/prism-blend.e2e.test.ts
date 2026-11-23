import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayerBlendAndOpacity, type LayerBlendAndOpacityProps } from '@nyc-tron/ui/components/forge/layers/LayerBlendAndOpacity';
import { CliHost } from '@nitro-forge/ignition/cli';
import { PRISM_ALPHA_MODES, PRISM_BLEND_MODE_IDS, PRISM_BLEND_MODES, PRISM_BLEND_SPACES, prismBlendCommand, prismLayerBlendValue, type PrismLayer } from '@nitro-forge/studio-workspace/prism-blend';
import { PrismDocument } from '../../../packages/prism/src/index';
import { BLEND_MODES } from '../../../packages/prism/src/canvas-types';

// F3 B-11 wiring. The markup checks render NYC-Tron's LayerBlendAndOpacity
// with the catalogs the Prism Layers panel passes, through the same
// react-native className binding the Vite host uses; the engine checks run
// the panel's commands against the real Rust engine through nf-cli
// (`cargo build --locked -p nf-cli` first).

const render = (props: Partial<LayerBlendAndOpacityProps>) => renderToStaticMarkup(createElement(LayerBlendAndOpacity, {
  scope: 'prism-layers', layerId: '2', value: prismLayerBlendValue({ id: 2, name: 'Paint', visible: true, opacity: 1, content: { type: 'raster' } })!,
  modes: PRISM_BLEND_MODES, spaces: PRISM_BLEND_SPACES, onCommit: () => {}, ...props,
}));

describe('B-11 LayerBlendAndOpacity alpha catalog', () => {
  it('offers Straight alpha only, as text, with no alpha menu to open', () => {
    const html = render({ alphaModes: PRISM_ALPHA_MODES });
    expect(html).toContain('Straight alpha');
    expect(html).not.toContain('Premultiplied');
    expect(html).not.toMatch(/aria-label="Layer alpha representation"/);
    expect(html).toMatch(/aria-label="Layer blend mode"/);
    expect(html).toMatch(/aria-label="Layer compositing space"/);
  });

  it('without the catalog Tron keeps its two-entry alpha menu, which Prism must not get', () => {
    expect(render({})).toMatch(/aria-label="Layer alpha representation"/);
  });

  it('Tron class names reach the markup through the className binding', () => {
    // MenuButton's own classes; React Native Web drops them without the binding.
    expect(render({ alphaModes: PRISM_ALPHA_MODES })).toMatch(/class="[^"]*\bmin-h-11\b/);
  });

  it('the shared mode list is exactly the modes the Prism API accepts', () => {
    expect([...PRISM_BLEND_MODE_IDS]).toEqual([...BLEND_MODES]);
  });
});

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe('B-11 Layers panel commands on Prism', () => {
  it('maps mode to setLayerBlend and opacity to setLayerOpacity, each one undo step', async () => {
    const doc = await PrismDocument.open(host, 8, 8);
    try {
      const id = (await doc.addRasterLayer('Paint')).data.layer_id;
      // The editor reads layers from `describe`, so the test does too.
      const layers = async () => (await doc.describe<{ layers: PrismLayer[] }>()).data.layers;
      const read = async () => prismLayerBlendValue((await layers()).find(layer => layer.id === id)!)!;
      const commit = async (next: Parameters<typeof prismBlendCommand>[2], kind: 'mode' | 'opacity') => {
        const command = prismBlendCommand(await layers(), id, next, kind)!;
        await doc.handle.apply(command.op, command.payload);
      };
      const start = await read();
      expect(start).toMatchObject({ mode: 'normal', opacity: 1, alphaMode: 'straight' });

      await commit({ ...start, mode: 'multiply' }, 'mode');
      const blended = await read();
      expect(blended.mode).toBe('multiply');
      await commit({ ...blended, opacity: 0.25 }, 'opacity');
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
