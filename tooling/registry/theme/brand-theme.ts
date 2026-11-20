// Rebrand contract for Nitro Forge studios (decisions 23 and 24).
// A brand overrides three theme keys per scheme and nothing else:
//   accent -> --color-primary, --color-accent, --color-focus
//   ink    -> --color-on-primary
//   soft   -> --color-primary-tint
// The six neutral keys, status colours, paper, every scale and the 4 px radius stay locked.
//
// TWO CHANNELS carry a brand, and they reach different surfaces. A rebrand needs both.
//   1. CSS variables: brandCssVariables(theme, scheme). Reaches every NYC-Tron control (Button, TabBar,
//      SegmentedControl, Select, Banner ...) and any Tailwind utility that reads --color-primary,
//      --color-accent, --color-focus, --color-on-primary or --color-primary-tint. Apply it on a
//      [data-brand] block, :root or a TokenScope. It does not reach JavaScript colour reads.
//   2. JS overrides: brandThemeOverrides(theme, scheme), passed as `themeOverrides` to ForgeWorkspace.
//      Reaches what ForgeWorkspace paints from workspace colours: header, rail label, document tab
//      accents, the studio glyphs and the soft chip behind them. PersonaTurret reads only
//      `colors.accent` and PersonaComposer reads `colors.accent` and `colors.soft`, from their own
//      `colors` prop, which ForgeWorkspace does not fill. Pass them the same overrides yourself.
//   Not reached by either channel: PrismEditor (chrome and direction palettes), QuillTextEditor
//   (workspaceThemes by scheme), ForgeDocumentStage (stage palette) and the ForgeIcon default palette.
//   Those keep their own colours until they take an override prop.
// The file brand.theme.json carries these values. It is separate from tooling/brand/brand.schema.json,
// which stays closed and keeps feeding the Expo plugin.
import { workspaceThemes } from './theme';

export const BRAND_OVERRIDE_KEYS = ['accent', 'ink', 'soft'] as const;
export type BrandOverrideKey = (typeof BRAND_OVERRIDE_KEYS)[number];
export type BrandScheme = 'dark' | 'light';
export type BrandDensity = 'compact' | 'standard' | 'comfortable';
export type BrandPalette = Readonly<Record<BrandOverrideKey, string>>;

export type BrandTheme = Readonly<{
  dark: BrandPalette;
  light: BrandPalette;
  defaultDensity?: BrandDensity;
}>;

/** CSS variables each overridable key feeds. Mirrors docs/agent-native/tokens.map.json rebrand.fanOut. */
export const BRAND_FAN_OUT: Readonly<Record<BrandOverrideKey, readonly `--${string}`[]>> = {
  accent: ['--color-primary', '--color-accent', '--color-focus'],
  ink: ['--color-on-primary'],
  soft: ['--color-primary-tint'],
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Relative luminance of a six-digit hex colour (WCAG 2.x). */
export function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * One contrast result. `ratio` is null when an input colour is missing or malformed: the entry then
 * fails and `problem` says which colour. A check never throws on bad input.
 */
export type BrandCheck = Readonly<{
  scheme: BrandScheme;
  rule: string;
  ratio: number | null;
  minimum: number;
  pass: boolean;
  problem?: string;
}>;

const hexOf = (palette: unknown, key: string): string | undefined => {
  const value = typeof palette === 'object' && palette !== null ? (palette as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' && HEX.test(value) ? value : undefined;
};

/**
 * Thresholds from docs/agent-native/02-design-system.md section 5.
 * Always returns six entries (three per scheme). Incomplete or malformed input yields failing entries
 * with a `problem`, so a caller can show every reason at once. Run `brandThemeProblems` for the structure.
 */
export function checkBrandTheme(theme: unknown): readonly BrandCheck[] {
  const checks: BrandCheck[] = [];
  const record = typeof theme === 'object' && theme !== null ? (theme as Record<string, unknown>) : {};
  for (const scheme of ['dark', 'light'] as const) {
    const palette = record[scheme];
    const neutrals = workspaceThemes[scheme];
    const add = (rule: string, minimum: number, pairs: readonly [label: string, hex: string | undefined][], measure: (hexes: string[]) => number) => {
      const missing = pairs.filter(([, hex]) => hex === undefined).map(([label]) => label);
      if (missing.length > 0) {
        checks.push({ scheme, rule, ratio: null, minimum, pass: false, problem: `${scheme}.${missing.join(' and ')} must be six hex digits, for example #6950D1` });
        return;
      }
      const ratio = measure(pairs.map(([, hex]) => hex as string));
      checks.push({ scheme, rule, ratio: Math.round(ratio * 100) / 100, minimum, pass: ratio >= minimum });
    };
    const accent = hexOf(palette, 'accent');
    const ink = hexOf(palette, 'ink');
    const soft = hexOf(palette, 'soft');
    add('ink on accent', 4.5, [['ink', ink], ['accent', accent]], ([a, b]) => contrastRatio(a, b));
    add('accent as focus on raised', 3, [['accent', accent]], ([a]) => contrastRatio(a, neutrals.raised));
    add('text on soft', 4.5, [['soft', soft]], ([a]) => contrastRatio(neutrals.text, a));
  }
  return checks;
}

const DENSITIES: readonly string[] = ['compact', 'standard', 'comfortable'];

/**
 * Channel 2: the partial `WorkspaceColors` for ForgeWorkspace `themeOverrides` (and the `colors` prop of
 * PersonaTurret and PersonaComposer, where the full object is built by spreading it over a base palette).
 */
export function brandThemeOverrides(theme: BrandTheme, scheme: BrandScheme): Readonly<Record<BrandOverrideKey, string>> {
  return { accent: theme[scheme].accent, ink: theme[scheme].ink, soft: theme[scheme].soft };
}

/** Problems that make a brand file invalid. An empty array means the file follows the contract. */
export function brandThemeProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) return ['brand.theme.json must be an object'];
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!['$schema', 'dark', 'light', 'defaultDensity'].includes(key)) problems.push(`"${key}" is not overridable`);
  }
  if ('defaultDensity' in record && (typeof record.defaultDensity !== 'string' || !DENSITIES.includes(record.defaultDensity))) {
    problems.push(`defaultDensity must be one of ${DENSITIES.join(', ')}`);
  }
  for (const scheme of ['dark', 'light'] as const) {
    const palette = record[scheme];
    if (typeof palette !== 'object' || palette === null) {
      problems.push(`"${scheme}" needs accent, ink and soft`);
      continue;
    }
    const entries = palette as Record<string, unknown>;
    for (const key of Object.keys(entries)) {
      if (!(BRAND_OVERRIDE_KEYS as readonly string[]).includes(key)) problems.push(`${scheme}.${key} is locked`);
    }
    for (const key of BRAND_OVERRIDE_KEYS) {
      const hex = entries[key];
      if (typeof hex !== 'string' || !HEX.test(hex)) problems.push(`${scheme}.${key} must be six hex digits, for example #6950D1`);
    }
  }
  return problems;
}

/** CSS custom properties for one scheme, ready for a [data-brand] block or a TokenScope. */
export function brandCssVariables(theme: BrandTheme, scheme: BrandScheme): Record<`--${string}`, string> {
  const out: Record<`--${string}`, string> = {};
  for (const key of BRAND_OVERRIDE_KEYS) {
    for (const name of BRAND_FAN_OUT[key]) out[name] = theme[scheme][key];
  }
  return out;
}
