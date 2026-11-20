// Rebrand contract for Nitro Forge studios (decisions 23 and 24).
// A brand overrides three theme keys per scheme and nothing else:
//   accent -> --color-primary, --color-accent, --color-focus
//   ink    -> --color-on-primary
//   soft   -> --color-primary-tint
// The six neutral keys, status colours, paper, every scale and the 4 px radius stay locked.
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

export type BrandCheck = Readonly<{ scheme: BrandScheme; rule: string; ratio: number; minimum: number; pass: boolean }>;

/** Thresholds from docs/agent-native/02-design-system.md section 5. */
export function checkBrandTheme(theme: BrandTheme): readonly BrandCheck[] {
  const checks: BrandCheck[] = [];
  for (const scheme of ['dark', 'light'] as const) {
    const palette = theme[scheme];
    const neutrals = workspaceThemes[scheme];
    const add = (rule: string, ratio: number, minimum: number) =>
      checks.push({ scheme, rule, ratio: Math.round(ratio * 100) / 100, minimum, pass: ratio >= minimum });
    add('ink on accent', contrastRatio(palette.ink, palette.accent), 4.5);
    add('accent as focus on raised', contrastRatio(palette.accent, neutrals.raised), 3);
    add('text on soft', contrastRatio(neutrals.text, palette.soft), 4.5);
  }
  return checks;
}

/** Problems that make a brand file invalid. An empty array means the file follows the contract. */
export function brandThemeProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) return ['brand.theme.json must be an object'];
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!['$schema', 'dark', 'light', 'defaultDensity'].includes(key)) problems.push(`"${key}" is not overridable`);
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
