/** App-neutral semantic contract. Hosts provide brand overrides; engines stay headless.
 * Tier names follow the documented Moyo shared-control contract. Values remain
 * Cool neutral chrome and violet selection keep the document visually dominant.
 */
export const workspaceThemes = {
  dark: { base: '#1C1E25', raised: '#262932', deep: '#15171D', line: '#393D49', text: '#F0F1F7', muted: '#ADB3C4', accent: '#B7A5FF', ink: '#211A3D', soft: '#38304F', paper: '#FFFEFC', paperInk: '#303440', paperMuted: '#797F8D', error: '#FFAAA7' },
  light: { base: '#F4F5F8', raised: '#FFFFFF', deep: '#E7EAF1', line: '#DDE1EB', text: '#252A3A', muted: '#687287', accent: '#6950D1', ink: '#FFFFFF', soft: '#EEE9FF', paper: '#FFFEFC', paperInk: '#303440', paperMuted: '#797F8D', error: '#B33E46' },
} as const;
export type WorkspaceColors = { [K in keyof typeof workspaceThemes.dark]: string };
export const workspaceScale = {
  space: { stack: 4, element: 8, inset: 12, group: 16, section: 24, canvas: 32, page: 64 },
  radius: { control: 8, panel: 12, paper: 2 },
  type: { micro: 10, label: 12, body: 14, title: 20, display: 32, manuscript: 20 },
  font: { serif: 'Georgia', mono: 'monospace' },
  size: { target: 44, rail: 72, header: 60, toolbar: 52, status: 28 },
} as const;
