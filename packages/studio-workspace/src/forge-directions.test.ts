import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_DIRECTION_IDS, forgeDirections, contrastRatio, luminance, glassAllowed, detentDurationMs,
  labCanvas, DEFAULT_TURRET_DIRECTION, workbenchChrome, type ForgeScheme,
} from './forge-directions.ts';

const schemes: ForgeScheme[] = ['dark', 'light'];
const backdrops = [labCanvas.dark.mat, labCanvas.light.mat, labCanvas.dark.paper];
const prefs = { reduceMotion: false, reduceTransparency: false, moreContrast: false };

test('panel text passes 4.5:1 on the solid panel and on glass over every backdrop', () => {
  for (const id of FORGE_DIRECTION_IDS) for (const scheme of schemes) {
    const m = forgeDirections[id].materials[scheme];
    for (const ink of [m.text, m.muted]) {
      const solid = contrastRatio(luminance(ink), luminance(m.panelSolid));
      assert.ok(solid >= 4.5, `${id}/${scheme} ${ink} on solid panel: ${solid.toFixed(2)}`);
      if (forgeDirections[id].glass) for (const under of backdrops) {
        const glass = contrastRatio(luminance(ink), luminance(m.panel, under));
        assert.ok(glass >= 4.5, `${id}/${scheme} ${ink} on glass over ${under}: ${glass.toFixed(2)}`);
      }
    }
  }
});

test('the face readout passes 4.5:1 across the whole lit face', () => {
  for (const id of FORGE_DIRECTION_IDS) for (const scheme of schemes) {
    const m = forgeDirections[id].materials[scheme];
    for (const stop of m.face) {
      const ratio = contrastRatio(luminance(m.faceText), luminance(stop));
      assert.ok(ratio >= 4.5, `${id}/${scheme} readout on ${stop}: ${ratio.toFixed(2)}`);
    }
  }
});

test('the accent reads as state (3:1) on the solid panel', () => {
  for (const id of FORGE_DIRECTION_IDS) for (const scheme of schemes) {
    const m = forgeDirections[id].materials[scheme];
    const ratio = contrastRatio(luminance(m.accent), luminance(m.panelSolid));
    assert.ok(ratio >= 3, `${id}/${scheme} accent: ${ratio.toFixed(2)}`);
  }
});

test('glass is chrome-only and drops out under Reduce Transparency or Increase Contrast', () => {
  assert.equal(glassAllowed(forgeDirections.optics, prefs), true);
  assert.equal(glassAllowed(forgeDirections.optics, { ...prefs, reduceTransparency: true }), false);
  assert.equal(glassAllowed(forgeDirections.optics, { ...prefs, moreContrast: true }), false);
  assert.equal(glassAllowed(forgeDirections.workbench, prefs), false);
  assert.equal(glassAllowed(forgeDirections.atelier, prefs), false);
});

test('directions differ on motion and Reduce Motion makes every detent instant', () => {
  const curves = new Set(FORGE_DIRECTION_IDS.map(id => forgeDirections[id].motion.easing));
  assert.equal(curves.size, 3);
  for (const id of FORGE_DIRECTION_IDS) {
    assert.ok(forgeDirections[id].motion.detentMs <= 320);
    assert.equal(detentDurationMs(forgeDirections[id], { ...prefs, reduceMotion: true }), 0);
  }
  assert.equal(DEFAULT_TURRET_DIRECTION, 'workbench');
});

test('the committed slot accent holds 3:1 on its halo in every direction and scheme', () => {
  for (const id of FORGE_DIRECTION_IDS) for (const scheme of ['dark', 'light'] as const) {
    const m = forgeDirections[id].materials[scheme];
    const ratio = contrastRatio(luminance(m.accent), luminance(m.accentHalo));
    assert.ok(ratio >= 3, `${id} ${scheme}: accent ${m.accent} on halo ${m.accentHalo} is ${ratio.toFixed(2)}:1`);
    assert.equal(forgeDirections[id].motion.easing, `cubic-bezier(${forgeDirections[id].motion.bezier.join(', ')})`);
  }
});

test('editor chrome: engraving reads at 4.5:1 and state marks at 3:1, in both materials', () => {
  const ratio = (a: string, b: string) => contrastRatio(luminance(a), luminance(b));
  for (const scheme of schemes) {
    const c = workbenchChrome[scheme];
    const text: [string, string, string][] = [
      ['text on body', c.text, c.body], ['muted on body', c.muted, c.body], ['muted in well', c.muted, c.well],
      ['text on selected row', c.text, c.selected], ['selected muted', c.selectedMuted, c.selected],
    ];
    for (const [name, ink, ground] of text) assert.ok(ratio(ink, ground) >= 4.5, `${scheme} ${name}: ${ratio(ink, ground).toFixed(2)}`);
    const marks: [string, string, string][] = [
      ['accent on body', c.accent, c.body], ['accent in well', c.accent, c.well], ['accent on selected row', c.accent, c.selected],
      ['chip ring on body', c.chipRing, c.body], ['disabled icon in well', c.disabledInk, c.well],
    ];
    for (const [name, ink, ground] of marks) assert.ok(ratio(ink, ground) >= 3, `${scheme} ${name}: ${ratio(ink, ground).toFixed(2)}`);
  }
  // Ceramic is near the light mat's value, so its chamfer line carries the panel edge.
  const light = workbenchChrome.light;
  assert.ok(ratio(light.edge, light.body) >= 3 && ratio(light.edge, labCanvas.light.mat) >= 3, 'light chamfer holds 3:1 on its face and on the mat');
});
