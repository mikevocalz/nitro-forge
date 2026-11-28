/**
 * Value-preserving tokens added on top of `theme.ts` (decisions 5, 6, 20, 21, 26, 27).
 *
 * Every entry equals the literal or the existing scale value it replaces, so
 * rewriting a component to read a token changes no pixel. Nothing here snaps a
 * value to the nearest step: a value that matches no scale step is an `off*`
 * token with the identical number.
 *
 * `theme.ts` stays the generating source. Values that already live in
 * `theme.ts`, `forge-directions.ts` or `interaction-policy.ts` are read from
 * there, not copied. The rest are literals that used to sit inside
 * components; the icon-tier literals mirror `@nitro-forge/icons` tokens.js and
 * `tokens.test.ts` fails if the two drift.
 *
 * `build-theme.mjs` turns this object into CSS through {@link cssTokens}. A CSS
 * variable is `--<group>-<key>` with the key in kebab case, and `_` between
 * digits becomes `-` (`off5_75` is `--spacing-off-5-75`).
 */
import { resolveWorkspaceScale, workspaceScale, workspaceThemes, WORKSPACE_DENSITIES, type WorkspaceDensity } from './theme.ts';
import { forgeDirections, forgeFeedbackMotion, labCanvas, workbenchChrome, type ForgeDirectionId, type ForgeScheme } from './forge-directions.ts';
import { forgeHitTarget, forgeMotionProfile, type ForgeMotionEvent } from './interaction-policy.ts';

export type SchemeValue = Readonly<{ dark: string; light: string }>;
export type TokenValue = string | number | SchemeValue;
export type TokenGroup = Readonly<Record<string, TokenValue>>;

/** Values with no home in `theme.ts`: the off-scale literals found in components. */
const offScale = {
  spacing: {
    off1_5: 1.5, off2: 2, off3: 3, off5: 5, off5_75: 5.75, off6: 6, off7: 7, off10: 10, off14: 14,
    off16: 16, off18: 18, off20: 20, off22: 22, off24: 24, off25: 25, off26: 26, off28: 28, off33: 33,
    off40: 40, off48: 48, off50: 50, off76: 76, off84: 84, off96: 96, off104: 104, off360: 360,
    off480: 480, off520: 520, off600: 600, off680: 680, off760: 760, off792: 792, off800: 800, off1200: 1200,
  },
  text: { off9: 9, off11: 11, off13: 13, off15: 15, off22: 22, off28: 28 },
  leading: { off18: 18, off19: 19 },
  tracking: { offNeg0_2: -0.2, off0_4: 0.4, off1: 1 },
  borderWidth: { off1_5: 1.5, off3: 3 },
} as const;

const standardScale = workspaceScale;

/** Colour roles Forge adds beyond NYC-Tron's scale (decision 26): Forge-local, not upstreamed. */
const forgeRoles = {
  surfaceBase: { dark: workspaceThemes.dark.base, light: workspaceThemes.light.base },
  primaryTint: { dark: workspaceThemes.dark.soft, light: workspaceThemes.light.soft },
  paper: { dark: workspaceThemes.dark.paper, light: workspaceThemes.light.paper },
  paperText: { dark: workspaceThemes.dark.paperInk, light: workspaceThemes.light.paperInk },
  paperTextMuted: { dark: workspaceThemes.dark.paperMuted, light: workspaceThemes.light.paperMuted },
} as const;

/** Icon palette, mirrored from `@nitro-forge/icons` (separate colours from the workspace: drift D1 to D4). */
const iconColour = {
  icon: { dark: '#F8FAFC', light: '#18202D' },
  iconMuted: '#737F91',
  iconSelected: '#6859E8',
  iconAccentBright: '#8E83FF',
  iconCyan: '#00B6C7',
  iconSuccess: '#139E75',
  iconWarning: '#C68B27',
  iconDanger: '#D94462',
  iconSurface: { dark: '#11131B', light: '#FFFFFF' },
} as const;

/** `stage.tsx` olive document palette (decision 27). Kept apart from `--color-paper`, which is `#FFFEFC`. Lower case, as written in `stage.tsx`. */
const stageColour = {
  stageHeading: { dark: '#eef0e9', light: '#202923' },
  stageTrack: '#222829',
  stagePaperText: '#283329',
  stagePaperTitle: '#354638',
  stageCaption: { dark: '#99a19d', light: '#556359' },
  stageGridHeadText: '#637161',
  stageClipAudio: '#637660',
  stageEmptyHint: '#798373',
  stagePaper: '#f7f5ed',
  stagePaperTextMuted: '#66735f',
  stageGridHead: '#e5e9dd',
  stageTrackBorder: '#39423f',
  stageSlideText: '#26372e',
  stageOnClip: '#ffffff',
  stageGridLine: '#dce0d5',
  stageFillFallback: '#d9b47a',
  stageTrackLabel: '#b9c7ba',
  stageQuoteRule: '#ad8551',
  stageClipVideo: '#725d7c',
  stageCellText: '#263b2b',
} as const;

const fixedColour = {
  scrim: '#000000',
  iconOnActive: '#FFFFFF',
  overlayChip: '#111827',
  onOverlayChip: '#FFFFFF',
  artboardCheckerA: '#FFFFFF',
  artboardCheckerB: '#EDEFF3',
} as const;

const camel = (text: string): string =>
  text.replace(/-([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());

const motionEvents: readonly ForgeMotionEvent[] = ['hover', 'press', 'selection', 'popover', 'panel-dock', 'detent', 'commit', 'cancel', 'error'];
const durationOf = (event: ForgeMotionEvent): number => forgeMotionProfile(event).durationMs;
const directionTurret: Readonly<Record<ForgeDirectionId, string>> = { workbench: 'snap', optics: 'reveal', atelier: 'dock' };
const directionIds = Object.keys(forgeDirections) as ForgeDirectionId[];

const schemes: readonly ForgeScheme[] = ['dark', 'light'];
const both = (read: (scheme: ForgeScheme) => string): SchemeValue => ({ dark: read('dark'), light: read('light') });
const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Instrument tier: each Forge 2046 direction's materials and depth, per scheme. */
function instrumentTokens(): { color: Record<string, SchemeValue>; shadow: Record<string, SchemeValue> } {
  const color: Record<string, SchemeValue> = {};
  const shadow: Record<string, SchemeValue> = {};
  for (const id of directionIds) {
    const direction = forgeDirections[id];
    const material = (scheme: ForgeScheme) => direction.materials[scheme];
    const add = (key: string, read: (scheme: ForgeScheme) => string | undefined) => {
      if (schemes.some(scheme => !read(scheme))) return;
      color[`instrument${upper(id)}${upper(key)}`] = both(scheme => read(scheme) ?? '');
    };
    add('panel', s => material(s).panel);
    add('panelEdge', s => material(s).panelEdge);
    add('panelSolid', s => material(s).panelSolid);
    add('face0', s => material(s).face[0]);
    add('face1', s => material(s).face[1]);
    add('lathe', s => material(s).lathe);
    for (const index of [0, 1, 2, 3]) add(`bezel${index}`, s => material(s).bezel[index]);
    add('knurl', s => material(s).knurl);
    add('notch', s => material(s).notch);
    add('text', s => material(s).text);
    add('muted', s => material(s).muted);
    add('faceText', s => material(s).faceText);
    add('accent', s => material(s).accent);
    add('accentHalo', s => material(s).accentHalo);
    for (const part of ['panel', 'dial'] as const) {
      // An empty depth string means "no shadow" (Optics dial); it has no CSS value to declare.
      if (schemes.some(scheme => !direction.depth[scheme][part])) continue;
      shadow[`instrument${upper(id)}${upper(part)}`] = both(scheme => direction.depth[scheme][part]);
    }
  }
  return { color, shadow };
}

const instrument = instrumentTokens();

const chromeKeys = ['body', 'edge', 'rule', 'well', 'selected', 'text', 'muted', 'selectedMuted', 'disabledInk', 'accent', 'press', 'chipEdge', 'chipRing'] as const;
const chromeColour: Record<string, SchemeValue> = {};
for (const key of chromeKeys) chromeColour[`chrome${upper(key)}`] = both(scheme => workbenchChrome[scheme][key]);
const labKeys = ['mat', 'paper', 'paperInk', 'ground'] as const;
const labColour: Record<string, SchemeValue> = {};
for (const key of labKeys) labColour[`lab${upper(key)}`] = both(scheme => labCanvas[scheme][key]);

const turretDuration: Record<string, number> = {};
const turretEase: Record<string, string> = {};
for (const id of directionIds) {
  turretDuration[`turret${upper(directionTurret[id])}`] = forgeDirections[id].motion.detentMs;
  turretEase[`turret${upper(directionTurret[id])}`] = forgeDirections[id].motion.easing;
}
const eventDuration: Record<string, number> = {};
for (const event of motionEvents) eventDuration[camel(event)] = durationOf(event);

export const tokens = {
  /** Density-invariant twins of the `--spacing-*` scale at standard density (row 21), plus off-scale literals. */
  spacing: {
    fixedStack: standardScale.space.stack,
    fixedElement: standardScale.space.element,
    fixedInset: standardScale.space.inset,
    fixedGroup: standardScale.space.group,
    fixedSection: standardScale.space.section,
    fixedCanvas: standardScale.space.canvas,
    fixedPage: standardScale.space.page,
    fixedTarget: standardScale.size.target,
    fixedRail: standardScale.size.rail,
    fixedHeader: standardScale.size.header,
    fixedToolbar: standardScale.size.toolbar,
    fixedStatus: standardScale.size.status,
    ...offScale.spacing,
  },
  text: {
    micro: standardScale.type.micro,
    label: standardScale.type.label,
    body: standardScale.type.body,
    title: standardScale.type.title,
    display: standardScale.type.display,
    manuscript: standardScale.type.manuscript,
    ...offScale.text,
  },
  leading: { ...offScale.leading },
  tracking: { ...offScale.tracking },
  // No radius group: radius values come only from `forgeRadius`, `forgeHairlineRadius` and
  // `workspaceScale.radius` in theme.ts, and their CSS only from build-theme.mjs
  // (design/DIRECTION.md radius rule, tooling/check-radius.mjs).
  borderWidth: { hairline: 1, strong: 2, ...offScale.borderWidth },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  font: {
    editorial: "Georgia, 'Times New Roman', serif",
    monoPlain: standardScale.font.mono,
  },
  z: { layerRow: 10, chrome: 20, fillBar: 25, toast: 35, panel: 60, overlay: 70 },
  opacity: { disabled: 0.52, scrim: 0.45, feedbackCommitPeak: forgeFeedbackMotion.commit.peakOpacity },
  hit: { target: forgeHitTarget('pointer'), targetTouch: forgeHitTarget('touch') },
  size: { iconXs: 12, iconSm: 16, iconToolbar: 20, iconDefault: 24, iconTouch: 28, iconFeature: 32, iconHero: 48 },
  stroke: { iconWidth: 2.35, iconBox: 24 },
  shadow: {
    floatSm: '0 3px 12px #00000020',
    floatMd: '0 4px 16px #00000030',
    artboard: '0 12px 35px #00000035',
    page: '0 8px 40px rgba(0,0,0,0.12)',
    segmentActive: '0 1px 2px #252A3A26',
    chromeDepth: both(scheme => workbenchChrome[scheme].depth),
    ...instrument.shadow,
  },
  swatch: { violet: '#6950D1', teal: '#249184', amber: '#E39B4C', rose: '#E26D92' },
  color: {
    ...forgeRoles,
    ...iconColour,
    ...fixedColour,
    ...stageColour,
    ...chromeColour,
    ...labColour,
    ...instrument.color,
  },
  duration: {
    iconHover: 120, iconPress: 110, iconSelect: 225, iconDeselect: 175, iconSuccess: 320, iconError: 240, iconLoading: 850,
    ...eventDuration,
    feedbackPress: forgeFeedbackMotion.press.ms,
    feedbackEndstopBeat: forgeFeedbackMotion.endStop.beatMs,
    feedbackCommit: forgeFeedbackMotion.commit.ms,
    ...turretDuration,
  },
  scale: { iconPress: 0.9, iconSelected: 1.075, feedbackPress: forgeFeedbackMotion.press.scale },
  spring: { iconStiffness: 260, iconDamping: 22, iconMass: 0.8 },
  angle: { feedbackEndstop: forgeFeedbackMotion.endStop.deg },
  ease: { ...turretEase },
} as const satisfies Readonly<Record<string, TokenGroup>>;

export type Tokens = typeof tokens;

/** Value-preserving rule: the CSS unit a numeric token carries, by group. Strings are emitted as written. */
const unitByGroup: Readonly<Record<string, string>> = {
  spacing: 'px', text: 'px', leading: 'px', tracking: 'px', borderWidth: 'px', size: 'px', hit: 'px',
  duration: 'ms', angle: 'deg',
};

export const kebab = (key: string): string =>
  key
    .replace(/_/g, '-')
    .replace(/([a-z])(\d)/g, '$1-$2')
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase();

/** `--<group>-<key>` for a token, for example `--spacing-off-5-75`. */
export const cssVarName = (group: string, key: string): string => `--${kebab(group)}-${kebab(key)}`;

const cssHex = (text: string): string => (/^#[0-9a-f]{3,8}$/i.test(text) ? text.toUpperCase() : text);
const cssText = (group: string, value: string | number): string =>
  typeof value === 'number' ? `${value}${unitByGroup[group] ?? ''}` : cssHex(value);

export type CssDeclaration = Readonly<{ name: string; value: string }>;
export type CssTokens = Readonly<{
  /** Same in every scheme; goes in the base `@theme` block. */
  shared: readonly CssDeclaration[];
  /** Scheme-dependent values. */
  dark: readonly CssDeclaration[];
  light: readonly CssDeclaration[];
  /** Density-aware `--spacing-*` values for each density that differs from standard. */
  density: Readonly<Record<Exclude<WorkspaceDensity, 'standard'>, readonly CssDeclaration[]>>;
}>;

/** Density-aware space and size variables (the 15 of tokens.map.json). */
function densityDeclarations(density: WorkspaceDensity): CssDeclaration[] {
  const scale = resolveWorkspaceScale(density);
  const out: CssDeclaration[] = [];
  for (const [key, value] of Object.entries(scale.space)) out.push({ name: cssVarName('spacing', key), value: `${value}px` });
  for (const [key, value] of Object.entries(scale.size)) out.push({ name: cssVarName('spacing', key), value: `${value}px` });
  return out;
}

export function cssTokens(): CssTokens {
  const shared: CssDeclaration[] = [];
  const dark: CssDeclaration[] = [];
  const light: CssDeclaration[] = [];
  for (const [group, entries] of Object.entries(tokens) as [string, TokenGroup][]) {
    for (const [key, value] of Object.entries(entries)) {
      const name = cssVarName(group, key);
      if (typeof value === 'object') {
        if (value.dark === value.light) shared.push({ name, value: cssHex(value.dark) });
        else {
          dark.push({ name, value: cssHex(value.dark) });
          light.push({ name, value: cssHex(value.light) });
        }
      } else shared.push({ name, value: cssText(group, value) });
    }
  }
  const standard = densityDeclarations('standard');
  const standardByName = new Map(standard.map(entry => [entry.name, entry.value]));
  const density = {} as Record<Exclude<WorkspaceDensity, 'standard'>, CssDeclaration[]>;
  for (const name of WORKSPACE_DENSITIES) {
    if (name === 'standard') continue;
    density[name] = densityDeclarations(name).filter(entry => standardByName.get(entry.name) !== entry.value);
  }
  return { shared: [...shared, ...standard], dark, light, density };
}
