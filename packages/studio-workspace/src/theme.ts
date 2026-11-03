/** App-neutral semantic contract. Hosts provide brand overrides; engines stay headless.
 * Tier names follow the documented Moyo shared-control contract. Values remain
 * NitroForge's existing neutral/amber identity, not Moyo's brand palette.
 */
export const workspaceThemes = {
  dark: { base: '#18191C', raised: '#202226', deep: '#121416', line: '#33363A', text: '#EEEDE7', muted: '#A1A5A7', accent: '#E8B66A', ink: '#191A1C', soft: '#302A22', paper: '#FFFEFA', paperInk: '#343631', paperMuted: '#8C8C82', error: '#F0A59A' },
  light: { base: '#F6F5F1', raised: '#FFFFFF', deep: '#EAEAE4', line: '#D4D8D0', text: '#292D2A', muted: '#657168', accent: '#8C6022', ink: '#FFFFFF', soft: '#F0E7D7', paper: '#FFFEFA', paperInk: '#343631', paperMuted: '#8C8C82', error: '#A53E35' },
} as const;
export type WorkspaceColors = { [K in keyof typeof workspaceThemes.dark]: string };
export const workspaceScale = {
  space: { stack: 4, element: 8, inset: 12, group: 16, section: 24, canvas: 32, page: 64 },
  radius: { control: 6, panel: 12, paper: 2 },
  type: { micro: 10, label: 12, body: 14, title: 20, display: 32, manuscript: 20 },
  font: { serif: 'Georgia', mono: 'monospace' },
  size: { target: 44, rail: 56, header: 68, toolbar: 48, status: 28 },
} as const;
