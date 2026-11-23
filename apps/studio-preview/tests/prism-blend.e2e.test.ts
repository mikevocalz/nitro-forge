import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuButton } from '@nyc-tron/ui/components/shell/MenuButton';
import { PrecisionScrubber } from '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber';
import { CliHost } from '@nitro-forge/ignition/cli';
import { PRISM_BLEND_MODE_IDS, PRISM_OPACITY_SCRUBBER, prismBlendCommand, prismBlendMenuItems, prismLayerBlendValue, type PrismBlendChange, type PrismLayer } from '@nitro-forge/studio-workspace/prism-blend';
import { PrismDocument } from '../../../packages/prism/src/index';
import { BLEND_MODES } from '../../../packages/prism/src/canvas-types';

// F3 B-11 wiring (decision D7). The markup checks render the two NYC-Tron
// controls the Prism Layers panel uses, with the props it passes, through
// the same react-native className binding the Vite host uses; the engine
// checks run the panel's commands against the real Rust engine through
// nf-cli (`cargo build --locked -p nf-cli` first).

describe('B-11 Layers panel controls', () => {
  it('the blend mode MenuButton carries its name and current mode', () => {
    const html = renderToStaticMarkup(createElement(MenuButton, {
      label: 'Layer blend mode', items: prismBlendMenuItems(), onSelect: () => {}, accessibilityValue: { text: 'Normal' },
      children: 'Normal',
    }));
    expect(html).toMatch(/aria-label="Layer blend mode"/);
    expect(html).toContain('Normal');
    // MenuButton's own classes; React Native Web drops them without the binding.
    expect(html).toMatch(/class="[^"]*\bmin-h-11\b/);
  });

  it('the opacity scrubber steps 1 % and reports whole percent', () => {
    const html = renderToStaticMarkup(createElement(PrecisionScrubber, { ...PRISM_OPACITY_SCRUBBER, value: 100, targetSize: 44, forcedColors: true, onCommit: () => {} }));
    expect(html).toMatch(/aria-label="Layer opacity"/);
    expect(html).toMatch(/aria-valuetext="100%"/);
    expect(html).toMatch(/aria-label="Decrease Layer opacity"/);
  });

  it('the shared mode list is exactly the modes the Prism API accepts', () => {
    expect([...PRISM_BLEND_MODE_IDS]).toEqual([...BLEND_MODES]);
    expect(prismBlendMenuItems().map(item => item.id)).toEqual([...BLEND_MODES]);
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
      const commit = async (change: PrismBlendChange) => {
        const command = prismBlendCommand(await layers(), id, change)!;
        await doc.handle.apply(command.op, command.payload);
      };
      const start = await read();
      expect(start).toMatchObject({ mode: 'normal', opacity: 1, alphaMode: 'straight' });

      await commit({ kind: 'mode', mode: 'multiply' });
      expect((await read()).mode).toBe('multiply');
      // Two presses of "−" on the scrubber: 99 %, then 98 %.
      await commit({ kind: 'opacity', percent: 99 });
      await commit({ kind: 'opacity', percent: 98 });
      expect(await read()).toMatchObject({ mode: 'multiply', opacity: 0.98 });

      expect(await doc.undo()).toBe(true);
      expect(await read()).toMatchObject({ mode: 'multiply', opacity: 0.99 });
      expect(await doc.undo()).toBe(true);
      expect(await doc.undo()).toBe(true);
      expect(await read()).toEqual(start);
      expect(await doc.redo()).toBe(true);
      expect((await read()).mode).toBe('multiply');
    } finally {
      await doc.close();
    }
  });
});
