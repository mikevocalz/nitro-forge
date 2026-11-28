/** App-neutral semantic contract. Hosts provide brand overrides; engines stay headless.
 * Semantic colours are consumed by the host-injected NYC UI components.
 * Cool suite chrome keeps documents visually dominant; Prism owns its canvas palette.
 * WCAG 2.1 AA, checked by theme-contrast.test.ts: `text`, `muted`, `accent` and
 * `error` reach 4.5:1 on `base`, `raised`, `deep` and `soft`; `ink` reaches 4.5:1
 * on `accent`; `paperInk` and `paperMuted` reach 4.5:1 on `paper`. `line` is a
 * decorative divider (about 1.1 to 1.8:1). `controlBorder` is the edge that
 * alone marks a well, an input or a dock panel, at 3:1 or more on every surface.
 */
export const workspaceThemes = {
  dark: { base: '#1C1E25', raised: '#262932', deep: '#15171D', line: '#393D49', controlBorder: '#70737D', text: '#F0F1F7', muted: '#ADB3C4', accent: '#B7A5FF', ink: '#211A3D', soft: '#38304F', paper: '#FFFEFC', paperInk: '#303440', paperMuted: '#707582', error: '#FFAAA7' },
  light: { base: '#F4F5F8', raised: '#FFFFFF', deep: '#E7EAF1', line: '#DDE1EB', controlBorder: '#818592', text: '#252A3A', muted: '#60697D', accent: '#6950D1', ink: '#FFFFFF', soft: '#EEE9FF', paper: '#FFFEFC', paperInk: '#303440', paperMuted: '#707582', error: '#B33E46' },
} as const;
export type WorkspaceColors = { [K in keyof typeof workspaceThemes.dark]: string };
/** The only two Forge view radii (design/DIRECTION.md). `md` is for outer views:
 * panels, cards, sheets, popovers, menus, dialogs, toasts, the studio switcher,
 * document and canvas frames. `sm` is for views nested inside those and for
 * every control. They become Tailwind's `rounded-sm` and `rounded-md` through
 * build-theme.mjs; tooling/check-radius.mjs rejects any other radius value. */
export const forgeRadius = { sm: 4, md: 6 } as const;
/** One of the two view radii; the type of every radius prop Forge passes to a control. */
export type ForgeRadiusValue = typeof forgeRadius[keyof typeof forgeRadius];
/** Sub-4 px radii for hairline details only (ticks, needles, meter segments). */
export const forgeHairlineRadius = { tick: 1, needle: 0.75 } as const;
export const workspaceScale = {
  space: { stack: 4, element: 8, inset: 12, group: 16, section: 24, canvas: 32, page: 64 },
  /** Role names over the two radii: `control` and inner views take `sm`;
   * `panel` (outer views) and `paper` (document frames) take `md`. */
  radius: { control: forgeRadius.sm, panel: forgeRadius.md, paper: forgeRadius.md },
  type: { micro: 10, label: 12, body: 14, title: 20, display: 32, manuscript: 20 },
  font: { serif: 'Georgia', mono: 'monospace' },
  size: { target: 44, rail: 72, header: 60, toolbar: 52, status: 28 },
} as const;

export const WORKSPACE_DENSITIES = ['compact', 'standard', 'comfortable'] as const;
export type WorkspaceDensity = typeof WORKSPACE_DENSITIES[number];
export type WorkspaceDensityScale = Readonly<{
  space: Readonly<{ [K in keyof typeof workspaceScale.space]: number }>;
  size: Readonly<{ [K in keyof typeof workspaceScale.size]: number } & {
    canvasHeader: number; canvasToolbar: number; canvasRail: number;
  }>;
  radius: typeof workspaceScale.radius;
  type: typeof workspaceScale.type;
  font: typeof workspaceScale.font;
}>;

const workspaceDensityScales: Readonly<Record<WorkspaceDensity, WorkspaceDensityScale>> = {
  compact: {
    ...workspaceScale,
    space: { stack: 4, element: 4, inset: 8, group: 12, section: 20, canvas: 24, page: 64 },
    size: { target: 44, rail: 64, header: 52, toolbar: 44, status: 24, canvasHeader: 44, canvasToolbar: 44, canvasRail: 48 },
  },
  standard: {
    ...workspaceScale,
    size: { ...workspaceScale.size, canvasHeader: 52, canvasToolbar: 44, canvasRail: 52 },
  },
  comfortable: {
    ...workspaceScale,
    space: { stack: 4, element: 12, inset: 16, group: 20, section: 32, canvas: 40, page: 64 },
    size: { target: 48, rail: 80, header: 68, toolbar: 60, status: 32, canvasHeader: 60, canvasToolbar: 52, canvasRail: 60 },
  },
};

export function isWorkspaceDensity(value: unknown): value is WorkspaceDensity {
  return value === 'compact' || value === 'standard' || value === 'comfortable';
}

/** Host-controlled chrome spacing. Density never scales text, changes radius or chooses a device layout. */
export function resolveWorkspaceScale(density: WorkspaceDensity = 'standard'): WorkspaceDensityScale {
  if (!isWorkspaceDensity(density)) throw new RangeError('Unknown workspace density');
  return workspaceDensityScales[density];
}

/** Status roles NYC-Tron's Banner, Badge and danger Button read. The chrome
 * above has no info or success colour of its own, so these start from
 * NYC-Tron's reference values (docs/THEME_TOKENS.md). Light `success` is
 * darkened from #1E7A3C so it reaches 4.5:1 on Prism's light `deep` too;
 * `onError` is text on the `error` fill. */
export const workspaceStatus = {
  dark: { info: '#8AB8FF', success: '#6FD08C', onError: '#2B0703' },
  light: { info: '#1D5FA8', success: '#1B6E36', onError: '#FFFFFF' },
} as const;

/** Canvas studio: graphite chrome and blue active tools, separate from suite branding.
 * Its `controlBorder` also holds 3:1 on the Workbench, Optics and Atelier
 * surfaces that forge-directions.ts derives from these palettes. */
export const prismThemes = {
  dark: { ...workspaceThemes.dark, base: '#232428', raised: '#303136', deep: '#18191D', line: '#424348', controlBorder: '#85868A', text: '#F2F3F5', muted: '#B8BBC4', accent: '#66B9FF', ink: '#081D2F', soft: '#173C59' },
  light: { ...workspaceThemes.light, base: '#ECEDEF', raised: '#FAFAFB', deep: '#D9DBDF', line: '#C9CCD2', controlBorder: '#6E6F73', text: '#25272D', muted: '#5C606A', accent: '#0762A7', ink: '#FFFFFF', soft: '#D6EAFB', error: '#A73A41' },
} as const;
