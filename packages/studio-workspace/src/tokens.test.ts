import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error icons/src/tokens.js ships without a declaration file
import { iconColors, iconLayout, iconMotion, iconOpacity, iconSizes, iconSpring, iconStroke, iconSurface } from '../../icons/src/tokens.js';
import { forgeDirections, forgeFeedbackMotion, workbenchChrome } from './forge-directions.ts';
import { forgeHitTarget, forgeMotionProfile } from './interaction-policy.ts';
import { resolveWorkspaceScale, workspaceScale, workspaceThemes } from './theme.ts';
import { cssTokens, cssVarName, kebab, tokens } from './tokens.ts';

// The derived keys are spread from Record<string, ...> builders, so the inferred type drops them; read them through an indexable view.
const derived = tokens as unknown as Record<'color' | 'shadow' | 'duration', Record<string, any>>;
const here = dirname(fileURLToPath(import.meta.url));
const css = cssTokens();
const everyName = [...css.shared, ...css.dark, ...css.light].map(entry => entry.name);

test('css variable names follow --group-key with digits split', () => {
  assert.equal(cssVarName('spacing', 'off5_75'), '--spacing-off-5-75');
  assert.equal(cssVarName('tracking', 'offNeg0_2'), '--tracking-off-neg-0-2');
  assert.equal(cssVarName('borderWidth', 'hairline'), '--border-width-hairline');
  assert.equal(cssVarName('color', 'instrumentWorkbenchFace0'), '--color-instrument-workbench-face-0');
  assert.equal(kebab('stageGridHeadText'), 'stage-grid-head-text');
});

test('no two tokens share a css variable name', () => {
  const darkNames = new Set(css.dark.map(entry => entry.name));
  const lightNames = new Set(css.light.map(entry => entry.name));
  assert.deepEqual([...darkNames].sort(), [...lightNames].sort());
  const sharedNames = css.shared.map(entry => entry.name);
  assert.equal(new Set(sharedNames).size, sharedNames.length);
  for (const name of darkNames) assert.ok(!sharedNames.includes(name), `${name} is both shared and per scheme`);
});

test('density-invariant twins equal the standard scale', () => {
  const standard = resolveWorkspaceScale('standard');
  assert.equal(tokens.spacing.fixedStack, standard.space.stack);
  assert.equal(tokens.spacing.fixedElement, standard.space.element);
  assert.equal(tokens.spacing.fixedInset, standard.space.inset);
  assert.equal(tokens.spacing.fixedGroup, standard.space.group);
  assert.equal(tokens.spacing.fixedSection, standard.space.section);
  assert.equal(tokens.spacing.fixedCanvas, standard.space.canvas);
  assert.equal(tokens.spacing.fixedPage, standard.space.page);
  assert.equal(tokens.spacing.fixedTarget, standard.size.target);
  assert.equal(tokens.spacing.fixedRail, standard.size.rail);
  assert.equal(tokens.spacing.fixedHeader, standard.size.header);
  assert.equal(tokens.spacing.fixedToolbar, standard.size.toolbar);
  assert.equal(tokens.spacing.fixedStatus, standard.size.status);
  assert.equal('radius' in tokens, false, 'radius tokens live in theme.ts only (check-radius.mjs)');
});

test('density blocks carry only values that differ from standard, and match resolveWorkspaceScale', () => {
  for (const density of ['compact', 'comfortable'] as const) {
    const scale = resolveWorkspaceScale(density);
    const standard = resolveWorkspaceScale('standard');
    const expected = new Map<string, string>();
    for (const [key, value] of Object.entries(scale.space)) if (value !== standard.space[key as keyof typeof standard.space]) expected.set(cssVarName('spacing', key), `${value}px`);
    for (const [key, value] of Object.entries(scale.size)) if (value !== standard.size[key as keyof typeof standard.size]) expected.set(cssVarName('spacing', key), `${value}px`);
    assert.deepEqual(new Map(css.density[density].map(entry => [entry.name, entry.value])), expected);
  }
});

test('icon-tier tokens equal @nitro-forge/icons tokens.js', () => {
  assert.equal(tokens.color.icon.dark, iconColors.inkInverse);
  assert.equal(tokens.color.icon.light, iconColors.ink);
  assert.equal(tokens.color.iconMuted, iconColors.muted);
  assert.equal(tokens.color.iconSelected, iconColors.accent);
  assert.equal(tokens.color.iconAccentBright, iconColors.accentBright);
  assert.equal(tokens.color.iconCyan, iconColors.cyan);
  assert.equal(tokens.color.iconSuccess, iconColors.positive);
  assert.equal(tokens.color.iconWarning, iconColors.warning);
  assert.equal(tokens.color.iconDanger, iconColors.negative);
  assert.deepEqual({ ...tokens.color.iconSurface }, { ...iconSurface });
  assert.equal(tokens.size.iconXs, iconSizes.xs);
  assert.equal(tokens.size.iconSm, iconSizes.sm);
  assert.equal(tokens.size.iconToolbar, iconSizes.toolbar);
  assert.equal(tokens.size.iconDefault, iconSizes.default);
  assert.equal(tokens.size.iconTouch, iconSizes.touch);
  assert.equal(tokens.size.iconFeature, iconSizes.feature);
  assert.equal(tokens.size.iconHero, iconSizes.hero);
  assert.equal(tokens.stroke.iconWidth, iconStroke.width);
  assert.equal(tokens.stroke.iconBox, iconStroke.size);
  assert.equal(tokens.duration.iconHover, iconMotion.hoverMs);
  assert.equal(tokens.duration.iconPress, iconMotion.pressMs);
  assert.equal(tokens.duration.iconSelect, iconMotion.selectMs);
  assert.equal(tokens.duration.iconDeselect, iconMotion.deselectMs);
  assert.equal(tokens.duration.iconSuccess, iconMotion.successMs);
  assert.equal(tokens.duration.iconError, iconMotion.errorMs);
  assert.equal(tokens.duration.iconLoading, iconMotion.loadingMs);
  assert.equal(tokens.scale.iconPress, iconMotion.pressScale);
  assert.equal(tokens.scale.iconSelected, iconMotion.selectedScale);
  assert.equal(tokens.spring.iconStiffness, iconSpring.stiffness);
  assert.equal(tokens.spring.iconDamping, iconSpring.damping);
  assert.equal(tokens.spring.iconMass, iconSpring.mass);
  assert.equal(tokens.opacity.disabled, iconOpacity.disabled);
  assert.equal(tokens.hit.target, iconLayout.hitTarget);
});

test('derived tokens read the sources that own them', () => {
  assert.equal(tokens.color.surfaceBase.dark, workspaceThemes.dark.base);
  assert.equal(tokens.color.primaryTint.light, workspaceThemes.light.soft);
  assert.equal(tokens.color.paperText.dark, workspaceThemes.dark.paperInk);
  assert.equal(derived.color.chromeBody.light, workbenchChrome.light.body);
  assert.equal(derived.color.instrumentOpticsBezel2.dark, forgeDirections.optics.materials.dark.bezel[2]);
  assert.equal(derived.shadow.instrumentAtelierDial.light, forgeDirections.atelier.depth.light.dial);
  assert.equal(derived.duration.panelDock, forgeMotionProfile('panel-dock').durationMs);
  assert.equal(derived.duration.turretReveal, forgeDirections.optics.motion.detentMs);
  assert.equal(tokens.ease.turretDock, forgeDirections.atelier.motion.easing);
  assert.equal(tokens.duration.feedbackCommit, forgeFeedbackMotion.commit.ms);
  assert.equal(tokens.hit.targetTouch, forgeHitTarget('touch'));
  assert.equal(tokens.hit.target, forgeHitTarget('pointer'));
});

test('off-scale twins keep the literal exactly, with no snapping', () => {
  assert.equal(tokens.spacing.off5_75, 5.75);
  assert.equal(tokens.tracking.offNeg0_2, -0.2);
  assert.equal(tokens.fontWeight.semibold, '600');
  assert.equal(tokens.color.stagePaper, '#f7f5ed');
  const declared = new Map(css.shared.map(entry => [entry.name, entry.value]));
  assert.equal(declared.get('--spacing-off-5-75'), '5.75px');
  assert.equal(declared.get('--tracking-off-neg-0-2'), '-0.2px');
  assert.equal(declared.get('--color-stage-paper'), '#F7F5ED');
  assert.equal(declared.get('--font-weight-semibold'), '600');
  assert.equal(declared.get('--opacity-scrim'), '0.45');
});

test('the committed css files contain every declaration tokens.ts produces', () => {
  const web = readFileSync(join(here, 'theme.css'), 'utf8');
  const native = readFileSync(join(here, 'theme.native.css'), 'utf8');
  for (const { name, value } of [...css.shared, ...css.dark, ...css.light]) {
    assert.ok(web.includes(`  ${name}: ${value};`), `theme.css is missing ${name}: ${value}; run pnpm build:theme`);
    assert.ok(native.includes(`  ${name}: ${value};`), `theme.native.css is missing ${name}: ${value}; run pnpm build:theme`);
  }
  for (const density of ['compact', 'comfortable'] as const) {
    assert.ok(web.includes(`[data-density="${density}"]`), `theme.css is missing the ${density} density block`);
    for (const { name, value } of css.density[density]) assert.ok(web.includes(`  ${name}: ${value};`));
  }
});
