/** Forge 2046 directions as tokens: one instrument grammar (geometry, copy,
 * state machine, 4 pt radius, 44 pt targets) rendered in three material
 * depths. A direction may change material, light, depth and motion; it never
 * changes what a control does. Rationale: design/DIRECTION.md.
 */
import { prismThemes, workspaceScale, type WorkspaceColors } from './theme.ts';

export type ForgeDirectionId = 'workbench' | 'optics' | 'atelier';
export type ForgeScheme = 'dark' | 'light';

/** Colours one direction paints with, per scheme. */
export type ForgeMaterial = Readonly<{
  /** Chrome panel the turret sits in. Optics paints it as glass. */
  panel: string;
  panelEdge: string;
  /** Opaque panel used when glass is refused (Increase Contrast, Reduce Transparency). */
  panelSolid: string;
  /** Dial face, lit from {@linkcode ForgeLight.angleDeg}: lit edge first, shadow edge second. */
  face: readonly [string, string];
  /** Lathe rings turned into the face. */
  lathe: string;
  /** Bezel, lit edge first. Optics passes a spectral list here. */
  bezel: readonly string[];
  /** Knurl ticks cut into the bezel. */
  knurl: string;
  /** Detent slot at each stop. */
  notch: string;
  text: string;
  muted: string;
  /** Readout text on the dial face. */
  faceText: string;
  accent: string;
  /** Ground drawn under the committed slot's accent so it holds 3:1 against
   * the bezel, which in light schemes is close to the accent's own value. */
  accentHalo: string;
}>;

export type ForgeLight = Readonly<{
  /** Where the one light comes from, degrees clockwise from the top. */
  angleDeg: number;
  /** `key`: one source, matte. `refract`: light enters at the rim. `ambient`: soft, sky-lit. */
  model: 'key' | 'refract' | 'ambient';
}>;

export type ForgeDepth = Readonly<{
  /** Panel shadow; empty string for none. */
  panel: string;
  /** Shadow under the dial body. */
  dial: string;
  /** Planes the direction stacks: chrome, instrument, content. */
  planes: 2 | 3;
}>;

export type ForgeMotion = Readonly<{
  /** Indicator travel between detents. Reduced motion makes it 0. */
  detentMs: number;
  easing: string;
  /** The same curve as `easing`, as control points for native timing. */
  bezier: readonly [number, number, number, number];
  /** Named curve from docs/ux motion tokens. */
  token: 'snap' | 'reveal' | 'dock';
}>;

export type ForgeGlass = Readonly<{ blurPx: number; saturate: number }>;

export type ForgeDirection = Readonly<{
  id: ForgeDirectionId;
  name: string;
  /** One sentence: what the object is made of. */
  concept: string;
  light: ForgeLight;
  depth: Readonly<Record<ForgeScheme, ForgeDepth>>;
  motion: ForgeMotion;
  /** Glass on chrome only, never on the dial or the canvas. */
  glass: ForgeGlass | null;
  materials: Readonly<Record<ForgeScheme, ForgeMaterial>>;
}>;

export const forgeDirections: Readonly<Record<ForgeDirectionId, ForgeDirection>> = {
  workbench: {
    id: 'workbench',
    name: 'Machined Workbench',
    concept: 'A graphite turret milled from one billet, lit from the upper left, with a detent slot cut for every persona.',
    light: { angleDeg: -45, model: 'key' },
    depth: {
      dark: { panel: '0 1px 0 #FFFFFF0F inset, 0 6px 14px #00000059', dial: '2px 3px 6px #00000073', planes: 3 },
      light: { panel: '0 1px 0 #FFFFFF inset, 0 6px 14px #1B1D2124', dial: '2px 3px 6px #1B1D2138', planes: 3 },
    },
    motion: { detentMs: 120, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', bezier: [0.22, 1, 0.36, 1], token: 'snap' },
    glass: null,
    materials: {
      dark: {
        panel: '#1E2024', panelEdge: '#3A3D44', panelSolid: '#1E2024',
        face: ['#3A3D45', '#191B1F'], lathe: '#FFFFFF', bezel: ['#565A64', '#141518'],
        knurl: '#6A6F7A', notch: '#08090B', text: '#F2F3F5', muted: '#B8BBC4', faceText: '#F2F3F5', accent: '#66B9FF', accentHalo: '#08090B',
      },
      light: {
        panel: '#ECEDEF', panelEdge: '#C3C6CD', panelSolid: '#ECEDEF',
        face: ['#FFFFFF', '#CDD0D7'], lathe: '#1F2228', bezel: ['#FFFFFF', '#9EA3AD'],
        knurl: '#7D828D', notch: '#3E434C', text: '#1F2228', muted: '#555B66', faceText: '#1F2228', accent: '#086CB8', accentHalo: '#FFFFFF',
      },
    },
  },
  optics: {
    id: 'optics',
    name: 'Chromatic Optics',
    concept: 'A dark glass well whose rim carries the studio accent and its neighbouring hues, under a frosted chrome pane.',
    light: { angleDeg: 0, model: 'refract' },
    depth: {
      dark: { panel: '0 1px 0 #FFFFFF24 inset, 0 10px 28px #0000004D', dial: '', planes: 3 },
      light: { panel: '0 1px 0 #FFFFFF inset, 0 10px 28px #1B1D211F', dial: '', planes: 3 },
    },
    motion: { detentMs: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', bezier: [0.16, 1, 0.3, 1], token: 'reveal' },
    glass: { blurPx: 18, saturate: 1.4 },
    materials: {
      dark: {
        panel: '#1C1E25C7', panelEdge: '#FFFFFF24', panelSolid: '#1C1E25',
        face: ['#17191E', '#0C0D10'], lathe: '#66B9FF', bezel: ['#66B9FF', '#7CDCCF', '#B7A5FF', '#66B9FF'],
        knurl: '#8FA4BC', notch: '#050607', text: '#F2F3F5', muted: '#C2C6D0', faceText: '#F2F3F5', accent: '#66B9FF', accentHalo: '#050607',
      },
      light: {
        panel: '#FAFAFCDB', panelEdge: '#FFFFFFCC', panelSolid: '#F4F5F8',
        face: ['#20232A', '#121418'], lathe: '#66B9FF', bezel: ['#086CB8', '#0F8C80', '#6950D1', '#086CB8'],
        knurl: '#5D6E82', notch: '#050607', text: '#1F2228', muted: '#4F5562', faceText: '#F2F3F5', accent: '#086CB8', accentHalo: '#FFFFFF',
      },
    },
  },
  atelier: {
    id: 'atelier',
    name: 'Spatial Atelier',
    concept: 'A ceramic selector on a floating panel that stands off the canvas on two shadow planes, ready to dock beside it.',
    light: { angleDeg: 0, model: 'ambient' },
    depth: {
      dark: { panel: '0 2px 4px #0000002E, 0 18px 40px #00000059', dial: '0 10px 22px #00000066', planes: 3 },
      light: { panel: '0 2px 4px #1B1D2114, 0 18px 40px #1B1D2129', dial: '0 10px 22px #1B1D2133', planes: 3 },
    },
    motion: { detentMs: 280, easing: 'cubic-bezier(0.25, 1, 0.5, 1)', bezier: [0.25, 1, 0.5, 1], token: 'dock' },
    glass: null,
    materials: {
      dark: {
        panel: '#2A2C31', panelEdge: '#44474F', panelSolid: '#2A2C31',
        face: ['#43464E', '#34373E'], lathe: '#FFFFFF', bezel: ['#4C4F58', '#3A3D44'],
        knurl: '#5D616B', notch: '#1A1B1F', text: '#F2F3F5', muted: '#BEC1CA', faceText: '#F2F3F5', accent: '#66B9FF', accentHalo: '#1A1B1F',
      },
      light: {
        panel: '#FAFAF8', panelEdge: '#DCDDE1', panelSolid: '#FAFAF8',
        face: ['#FFFFFF', '#ECEDEF'], lathe: '#1F2228', bezel: ['#F2F3F5', '#DADCE0'],
        knurl: '#A3A7AF', notch: '#6B707A', text: '#1F2228', muted: '#555B66', faceText: '#1F2228', accent: '#086CB8', accentHalo: '#FFFFFF',
      },
    },
  },
};

/** The turret's direction in the Prism editor. Optics and Atelier are lab-only. */
export const DEFAULT_TURRET_DIRECTION: ForgeDirectionId = 'workbench';

export const FORGE_DIRECTION_IDS: readonly ForgeDirectionId[] = ['workbench', 'optics', 'atelier'];

export function isForgeDirection(value: unknown): value is ForgeDirectionId {
  return value === 'workbench' || value === 'optics' || value === 'atelier';
}

/** Accessibility settings that change how a direction renders. */
export type ForgeRenderPrefs = Readonly<{ reduceMotion: boolean; reduceTransparency: boolean; moreContrast: boolean;
  /** Windows High Contrast and other forced palettes (web `forced-colors: active`). */
  forcedColors?: boolean }>;

/** A CSS system colour for forced-colours mode (web only). React Native Web
 * drops colour keywords it does not know, `CanvasText` and `Highlight`
 * included, but passes `var()` through; the empty custom property falls back
 * to the keyword, which the browser resolves to the user's palette. Pair it
 * with `forced-color-adjust: none` on the element. */
export type SystemColor = 'Canvas' | 'CanvasText' | 'Highlight' | 'HighlightText' | 'GrayText' | 'ButtonText' | 'LinkText';
export const systemColor = (name: SystemColor): string => `var(--forge-system-${name}, ${name})`;

/** Feedback timings shared by every direction (forge-designer-pro motion.md):
 * `press` on touch down, `endStop` the two-beat nudge at a limit, `commit`
 * the rim flash that confirms a switch. */
export const forgeFeedbackMotion = {
  press: { ms: 80, scale: 0.96 },
  endStop: { beatMs: 60, deg: 3 },
  commit: { ms: 200, peakOpacity: 0.9 },
} as const;

/** Whether the chrome may be glass right now. */
export function glassAllowed(direction: ForgeDirection, prefs: ForgeRenderPrefs): boolean {
  return direction.glass !== null && !prefs.reduceTransparency && !prefs.moreContrast;
}

/** Indicator travel for the current settings: instant under Reduce Motion. */
export function detentDurationMs(direction: ForgeDirection, prefs: ForgeRenderPrefs): number {
  return prefs.reduceMotion ? 0 : direction.motion.detentMs;
}

/** Turret geometry shared by every direction, in logical points. */
export const turretGeometry = {
  /** Outer bezel radius. */
  bezel: 66,
  /** Dial face radius. */
  face: 48,
  /** Depth of a detent slot into the bezel. */
  notch: 14,
  /** Knurl ticks around the bezel. */
  knurlCount: 72,
  /** Gap between the bezel and the near edge of each stop's name. */
  labelGap: 14,
  /** Stop name target. 44 pt tall at minimum. */
  labelWidth: 80,
  labelHeight: 44,
  /** The dial's drawing box. */
  boxWidth: 300,
  boxTop: 128,
  boxHeight: 200,
} as const;

/** Prism's four fill swatches, mirrored from `FILL_COLORS` in prism-editor.tsx
 * for the lab. Prism keeps its own copy; change both together. */
export const prismFillSwatches = [
  { name: 'violet', hex: '#6950D1' },
  { name: 'teal', hex: '#249184' },
  { name: 'amber', hex: '#E39B4C' },
  { name: 'rose', hex: '#E26D92' },
] as const;

/** Prism's editor chrome (toolbar, tool rail, layers panel, fill bar and the
 * persona popover) cut from the Workbench billet, so the panels and the dial
 * read as one material. Dark is graphite. Light is white ceramic with dark
 * engraving and a chamfer line drawn dark enough to hold its edge on the
 * light mat; it is designed for daylight, not inverted from graphite.
 * Contrast pairs are checked in forge-directions.test.ts. */
export type ForgeChrome = Readonly<{
  /** Panel face. */
  body: string;
  /** Outer chamfer line around every panel. */
  edge: string;
  /** Hairlines inside a panel: row splits, section rules. */
  rule: string;
  /** Recessed ground: unavailable controls, inputs. */
  well: string;
  /** Ground of the selected row. */
  selected: string;
  text: string;
  muted: string;
  /** Secondary text on {@linkcode ForgeChrome.selected}. */
  selectedMuted: string;
  /** Icon ink of an unavailable control in the well. */
  disabledInk: string;
  accent: string;
  /** Tint under a pressed control. */
  press: string;
  /** Hairline around a colour chip, so a chip near the body's value keeps its shape. */
  chipEdge: string;
  /** Ring around the chosen colour chip. */
  chipRing: string;
  /** Lit top edge over the panel's short shadow. */
  depth: string;
}>;

export const workbenchChrome: Readonly<Record<ForgeScheme, ForgeChrome>> = {
  dark: {
    body: '#1E2024', edge: '#3A3D44', rule: '#2E3036', well: '#141518', selected: '#2B3846',
    text: '#F2F3F5', muted: '#B8BBC4', selectedMuted: '#D5E3F0', disabledInk: '#858991', accent: '#66B9FF',
    press: '#FFFFFF14', chipEdge: '#FFFFFF59', chipRing: '#F2F3F5', depth: forgeDirections.workbench.depth.dark.panel,
  },
  light: {
    body: '#ECEDEF', edge: '#737882', rule: '#CDD0D6', well: '#DADCE1', selected: '#D3E4F4',
    text: '#1F2228', muted: '#555B66', selectedMuted: '#2F4357', disabledInk: '#6B707A', accent: '#086CB8',
    press: '#1F222814', chipEdge: '#1F222859', chipRing: '#1F2228', depth: forgeDirections.workbench.depth.light.panel,
  },
};

/** The chrome as a palette for shared controls (the Precision Scrubber). */
export function chromePalette(scheme: ForgeScheme): WorkspaceColors {
  const c = workbenchChrome[scheme];
  return { ...prismThemes[scheme], base: c.body, raised: c.body, deep: c.well, line: c.rule, text: c.text, muted: c.muted, accent: c.accent };
}

/**
 * NYC-Tron UI ships no colours; its recipes read these semantic variables
 * (docs/THEME_TOKENS.md in NYC-Tron-UI). Forge fills them from the Workbench
 * chrome so NYC-Tron parts inside an editor panel match the panel around them:
 * the list ground is the panel body, the selected row is the chrome's
 * selection, rules are the panel's rules.
 */
export function nycTronTokens(scheme: ForgeScheme): Readonly<Record<`--${string}`, string>> {
  return nycTronTokensFor(chromePalette(scheme), workbenchChrome[scheme].selected);
}

/** The same variables from any studio palette; `selected` grounds the chosen row and active controls. */
export function nycTronTokensFor(colors: WorkspaceColors, selected = colors.raised): Readonly<Record<`--${string}`, string>> {
  return {
    '--color-surface-sunken': colors.base,
    '--color-surface-raised': selected,
    '--color-border': colors.line,
    '--color-text': colors.text,
    '--color-text-muted': colors.muted,
    '--color-accent': colors.accent,
    '--color-focus': colors.accent,
    '--radius-control': `${workspaceScale.radius.control}px`,
  };
}

/** Lab backdrop: the Prism mat and an 800 x 600 artboard behind the chrome. */
export const labCanvas = {
  dark: { mat: '#18191D', paper: '#FFFEFC', paperInk: '#303440', ground: '#121316' },
  light: { mat: '#D9DBDF', paper: '#FFFEFC', paperInk: '#303440', ground: '#E4E6EA' },
} as const;

/** WCAG relative luminance of `#RRGGBB` or `#RRGGBBAA` composited over `under`. */
export function luminance(hex: string, under = '#000000'): number {
  const parse = (h: string) => {
    const v = h.replace('#', '');
    const n = (i: number) => parseInt(v.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: v.length === 8 ? n(6) : 1 };
  };
  const top = parse(hex), bottom = parse(under);
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(mix(top.r, bottom.r)) + 0.7152 * lin(mix(top.g, bottom.g)) + 0.0722 * lin(mix(top.b, bottom.b));
}

/** WCAG contrast ratio of two luminances. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The workspace palette a direction hands to shared controls (the Precision
 * Scrubber, buttons): its materials over Prism's soft and error roles. */
export function directionPalette(direction: ForgeDirection, scheme: ForgeScheme): WorkspaceColors {
  const m = direction.materials[scheme];
  const prism = prismThemes[scheme];
  return {
    ...prism,
    base: m.panelSolid, raised: m.panelSolid, deep: m.face[1],
    line: m.panelEdge.length === 9 ? prism.line : m.panelEdge, text: m.text, muted: m.muted, accent: m.accent,
  };
}
