## Purpose

**Prerequisite.** Needs the `studio-theme` item for the neutral colours it checks against. No StudioUIProvider is needed.

The rebrand contract as a file and a validator. A brand sets three keys per scheme, `accent`, `ink` and `soft`, and nothing else. `brand-theme.ts` maps them to CSS variables and checks the three contrast pairs the contract requires.

A brand reaches the UI through two channels, and a rebrand needs both:

| Channel | Call | Reaches | Does not reach |
|---|---|---|---|
| CSS variables | `brandCssVariables(theme, scheme)` on a `[data-brand]` block, `:root` or a `TokenScope` | Every NYC-Tron control (Button, TabBar, SegmentedControl, Select, Banner) and any Tailwind utility reading `--color-primary`, `--color-accent`, `--color-focus`, `--color-on-primary` or `--color-primary-tint` | Anything Forge paints from JavaScript colour values |
| JS overrides | `brandThemeOverrides(theme, scheme)` as `themeOverrides` on `ForgeWorkspace` | Workspace header, rail label, studio glyphs and the soft chip behind them. `PersonaTurret` reads `colors.accent` and `PersonaComposer` reads `colors.accent` and `colors.soft` from their own `colors` prop, which `ForgeWorkspace` does not fill: pass the same overrides to them | The CSS variables above |

Neither channel reaches `PrismEditor` (chrome and direction palettes), `QuillTextEditor` (`workspaceThemes` by scheme), `ForgeDocumentStage` (stage palette) or the default `ForgeIcon` palette. They keep their own colours until they take an override prop.

## Install

- Package: `@nitro-forge/brand-theme` (registry item)
- Import: `import { brandThemeProblems, checkBrandTheme, brandCssVariables } from '@/components/forge/brand-theme';`
- Peers: none
- Requires: `@nitro-forge/studio-theme`
- Command: `npx shadcn@latest add @nitro-forge/brand-theme`

## Props

Not a component. Exports and what they take:

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| BRAND_OVERRIDE_KEYS | `readonly ["accent", "ink", "soft"]` | none | no | The only overridable keys. |
| BRAND_FAN_OUT | `Record<key, readonly string[]>` | none | no | CSS variables each key feeds: `accent` to `--color-primary`, `--color-accent`, `--color-focus`; `ink` to `--color-on-primary`; `soft` to `--color-primary-tint`. |
| brandThemeProblems | `(value: unknown) => string[]` | none | no | Empty array when the value follows the contract. Names every locked key it finds, every colour that is not six hex digits and a `defaultDensity` outside `compact`, `standard`, `comfortable`. |
| checkBrandTheme | `(theme: unknown) => BrandCheck[]` | none | no | Three pairs per scheme: `ink` on `accent` at 4.5:1, `accent` as a focus ring on the raised surface at 3:1, `text` on `soft` at 4.5:1. Always returns six entries and never throws: a missing or malformed colour gives an entry with `pass: false`, `ratio: null` and a `problem` that names it. |
| brandCssVariables | `(theme, scheme) => Record<string, string>` | none | no | Channel 1. Variables for a `[data-brand]` block or a `TokenScope`. |
| brandThemeOverrides | `(theme, scheme) => { accent, ink, soft }` | none | no | Channel 2. The partial colour object for `ForgeWorkspace` `themeOverrides`. |
| contrastRatio, luminance | `(a: string, b: string) => number`, `(hex: string) => number` | none | no | WCAG 2.x. |

The file `brand.theme.schema.json` is the JSON Schema for `brand.theme.json`. `brand.theme.json` is a starter written as today's Prism override.

## Variants

none

## States

| State | How it is set | What the code does |
|---|---|---|
| Valid | `brandThemeProblems` returns `[]` | The file follows the contract. Contrast is a separate check. |
| Locked key | A key other than `accent`, `ink` or `soft`, or a key outside `dark`, `light`, `defaultDensity` | Reported as a problem. |
| Low contrast | `checkBrandTheme` returns an entry with `pass: false` and a numeric `ratio` | The brand is readable only if every entry passes. |
| Incomplete input | `checkBrandTheme` returns an entry with `pass: false`, `ratio: null` and a `problem` | No throw. Run `brandThemeProblems` as well to see the structure problems. |

## A11y

- No UI. The three checks protect text and focus contrast for any brand.
- The six neutral keys stay locked until the owner supplies a contrast check (decision 23). The check does not measure them.
- Review status: unverified. No rendered check exists.

## Example

```tsx example=brand-theme
import { brandCssVariables, brandThemeOverrides, brandThemeProblems, checkBrandTheme, type BrandTheme } from '@/components/forge/brand-theme';

const theme: BrandTheme = {
  dark: { accent: '#66B9FF', ink: '#081D2F', soft: '#173C59' },
  light: { accent: '#086CB8', ink: '#FFFFFF', soft: '#D6EAFB' },
  defaultDensity: 'standard',
};

export const problems = brandThemeProblems(theme);
export const failing = checkBrandTheme(theme).filter((check) => !check.pass);

// Channel 1: CSS variables for the NYC-Tron controls. Apply on a [data-brand] block or a TokenScope.
export const cssVariables = brandCssVariables(theme, 'dark');
// Channel 2: JS colours. Pass as themeOverrides to ForgeWorkspace, and as colors to PersonaTurret and PersonaComposer.
export const themeOverrides = brandThemeOverrides(theme, 'dark');
```

## Do/Don't

### Do

- Override only `accent`, `ink` and `soft` in both `dark` and `light` (`BRAND_OVERRIDE_KEYS`).
- Run `brandThemeProblems` and `checkBrandTheme` before shipping a palette and read every entry with `pass: false`.
- Apply both channels: `brandCssVariables` for the NYC-Tron controls and `brandThemeOverrides` for `ForgeWorkspace`, `PersonaTurret` and `PersonaComposer`.

### Don't

- Do not add `base`, `raised`, `text` or any radius key; `brandThemeProblems` reports each as locked.
- Do not expect `brandCssVariables` alone to recolour the workspace header, studio glyphs or persona turret. They read JavaScript colours.
- Do not edit `tooling/brand/brand.schema.json` for colour; it stays closed and feeds the Expo plugin (decision 24).
