import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prismThemes, workspaceStatus, workspaceThemes, type WorkspaceColors } from './theme.ts';
import { FORGE_DIRECTION_IDS, chromePalette, contrastRatio, directionPalette, forgeDirections, luminance, type ForgeScheme } from './forge-directions.ts';

// WCAG 2.1 AA: 1.4.3 text at 4.5:1, 1.4.11 control boundaries and focus at 3:1.
const TEXT = 4.5, NON_TEXT = 3;
const schemes: ForgeScheme[] = ['dark', 'light'];
const palettes: Record<string, { colors: WorkspaceColors; scheme: ForgeScheme }> = {
  'workspace.dark': { colors: workspaceThemes.dark, scheme: 'dark' },
  'workspace.light': { colors: workspaceThemes.light, scheme: 'light' },
  'prism.dark': { colors: prismThemes.dark, scheme: 'dark' },
  'prism.light': { colors: prismThemes.light, scheme: 'light' },
};
const ratio = (fg: string, bg: string) => contrastRatio(luminance(fg), luminance(bg));
const surfaces = ['base', 'raised', 'deep'] as const;

/** Every foreground/background pair the chrome draws, with its threshold. */
function pairs(colors: WorkspaceColors, scheme: ForgeScheme) {
  const status = workspaceStatus[scheme];
  const list: { name: string; fg: string; bg: string; min: number }[] = [];
  for (const fg of ['text', 'muted', 'accent', 'error'] as const)
    for (const bg of [...surfaces, 'soft'] as const) list.push({ name: `${fg} on ${bg}`, fg: colors[fg], bg: colors[bg], min: TEXT });
  list.push({ name: 'ink on accent', fg: colors.ink, bg: colors.accent, min: TEXT });
  list.push({ name: 'paperInk on paper', fg: colors.paperInk, bg: colors.paper, min: TEXT });
  list.push({ name: 'paperMuted on paper', fg: colors.paperMuted, bg: colors.paper, min: TEXT });
  for (const role of ['info', 'success'] as const)
    for (const bg of surfaces) list.push({ name: `${role} on ${bg}`, fg: status[role], bg: colors[bg], min: TEXT });
  list.push({ name: 'onError on error', fg: status.onError, bg: colors.error, min: TEXT });
  for (const bg of surfaces) {
    list.push({ name: `controlBorder against ${bg}`, fg: colors.controlBorder, bg: colors[bg], min: NON_TEXT });
    list.push({ name: `focus (accent) against ${bg}`, fg: colors.accent, bg: colors[bg], min: NON_TEXT });
  }
  return list;
}

test('every chrome token pair meets its WCAG 2.1 AA threshold in all four palettes', () => {
  const failures: string[] = [];
  for (const [id, { colors, scheme }] of Object.entries(palettes))
    for (const pair of pairs(colors, scheme)) {
      const value = ratio(pair.fg, pair.bg);
      if (value < pair.min) failures.push(`${id} ${pair.name} (${pair.fg} on ${pair.bg}): ${value.toFixed(2)} < ${pair.min}`);
    }
  assert.deepEqual(failures, []);
});

test('the control border holds 3:1 in the palettes derived from Prism', () => {
  for (const scheme of schemes) {
    const derived: Record<string, WorkspaceColors> = { chrome: chromePalette(scheme) };
    for (const id of FORGE_DIRECTION_IDS) derived[id] = directionPalette(forgeDirections[id], scheme);
    for (const [id, colors] of Object.entries(derived)) for (const bg of surfaces) {
      const value = ratio(colors.controlBorder, colors[bg]);
      assert.ok(value >= NON_TEXT, `${id}/${scheme} controlBorder against ${bg}: ${value.toFixed(2)}`);
    }
  }
});

test('the divider stays a divider: line is not the control boundary', () => {
  // `line` is decorative; the 3:1 edge is `controlBorder`, so the two must differ.
  for (const { colors } of Object.values(palettes)) assert.notEqual(colors.line, colors.controlBorder);
});

test('the workspace chrome draws no hard-coded ink on the accent fill', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.equal(/#FFFFFF|#fff\b/i.test(source), false, 'use colors.ink on an accent fill');
});

test('the studio preview focus ring reads the theme focus token', () => {
  const css = readFileSync(new URL('../../../apps/studio-preview/src/style.css', import.meta.url), 'utf8');
  assert.equal(css.includes('#e9c685'), false, 'stale gold focus colour');
  // Every focus ring takes --color-focus (3:1 or more, checked above), except
  // the forced-colors override, which takes the system Highlight.
  const rings = [...css.matchAll(/([^{}]*:focus-visible[^{]*)\{([^}]*)\}/g)].filter(m => /outline(-color)?:/.test(m[2]!));
  assert.ok(rings.length >= 3);
  for (const [, selector, body] of rings)
    if (!/Highlight/.test(body!)) assert.match(body!, /outline(-color)?:[^;]*var\(--color-focus\)/, selector!.trim());
});
