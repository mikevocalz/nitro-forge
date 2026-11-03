/** App-neutral semantic contract. Hosts provide brand overrides; engines stay headless.
 * Semantic colours are consumed by the host-injected NYC UI components.
 * Cool suite chrome keeps documents visually dominant; Prism owns its canvas palette.
 */
export const workspaceThemes = {
  dark: { base: '#1C1E25', raised: '#262932', deep: '#15171D', line: '#393D49', text: '#F0F1F7', muted: '#ADB3C4', accent: '#B7A5FF', ink: '#211A3D', soft: '#38304F', paper: '#FFFEFC', paperInk: '#303440', paperMuted: '#797F8D', error: '#FFAAA7' },
  light: { base: '#F4F5F8', raised: '#FFFFFF', deep: '#E7EAF1', line: '#DDE1EB', text: '#252A3A', muted: '#687287', accent: '#6950D1', ink: '#FFFFFF', soft: '#EEE9FF', paper: '#FFFEFC', paperInk: '#303440', paperMuted: '#797F8D', error: '#B33E46' },
} as const;
export type WorkspaceColors = { [K in keyof typeof workspaceThemes.dark]: string };
export const workspaceScale = {
  space: { stack: 4, element: 8, inset: 12, group: 16, section: 24, canvas: 32, page: 64 },
  radius: { control: 4, panel: 4, paper: 2 },
  type: { micro: 10, label: 12, body: 14, title: 20, display: 32, manuscript: 20 },
  font: { serif: 'Georgia', mono: 'monospace' },
  size: { target: 44, rail: 72, header: 60, toolbar: 52, status: 28 },
} as const;

/** Canvas studio: graphite chrome and blue active tools, separate from suite branding. */
export const prismThemes = {
  dark: { ...workspaceThemes.dark, base: '#232428', raised: '#303136', deep: '#18191D', line: '#424348', text: '#F2F3F5', muted: '#B8BBC4', accent: '#66B9FF', ink: '#081D2F', soft: '#173C59' },
  light: { ...workspaceThemes.light, base: '#ECEDEF', raised: '#FAFAFB', deep: '#D9DBDF', line: '#C9CCD2', text: '#25272D', muted: '#656A74', accent: '#086CB8', ink: '#FFFFFF', soft: '#D6EAFB' },
} as const;
