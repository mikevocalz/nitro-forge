import { writeFileSync } from 'node:fs';
import { workspaceThemes, workspaceScale, workspaceStatus } from './src/theme.ts';
import { cssTokens } from './src/tokens.ts';
const names = { base: 'surface', raised: 'raised', deep: 'mat', line: 'border', text: 'text', muted: 'muted', accent: 'accent', ink: 'on-accent', soft: 'tint', paper: 'paper', paperInk: 'paper-ink', paperMuted: 'paper-muted', error: 'error' };
const forge = values => Object.entries(values).map(([key, value]) => `  --color-forge-${names[key]}: ${value};`);
// NYC-Tron UI ships no colours: its recipes read these variables
// (docs/THEME_TOKENS.md in NYC-Tron-UI). Forge fills them from its chrome.
const nycTron = scheme => {
  const c = workspaceThemes[scheme], s = workspaceStatus[scheme];
  return Object.entries({
    primary: c.accent, 'on-primary': c.ink, 'surface-raised': c.raised, 'surface-sunken': c.deep,
    border: c.line, text: c.text, 'text-muted': c.muted, danger: c.error, 'on-danger': s.onError,
    accent: c.accent, info: s.info, success: s.success, focus: c.accent,
  }).map(([key, value]) => `  --color-${key}: ${value};`);
};
const rules = scheme => [...forge(workspaceThemes[scheme]), ...nycTron(scheme)].join('\n');
// Additive tokens from tokens.ts (value-preserving, decisions 5, 6, 20, 21, 26, 27).
// They only append declarations: every variable above keeps its name and value.
const added = cssTokens();
const declare = list => list.map(({ name, value }) => `  ${name}: ${value};`).join('\n');
const densityBlocks = Object.entries(added.density)
  .filter(([, list]) => list.length > 0)
  .map(([name, list]) => `[data-density="${name}"] {\n${declare(list)}\n}\n`).join('');
const metrics = `  --spacing-forge-target: ${workspaceScale.size.target}px;
  --radius-sm: ${workspaceScale.radius.control}px;
  --radius-forge-control: ${workspaceScale.radius.control}px;
  --radius-control: ${workspaceScale.radius.control}px;
  --radius-card: ${workspaceScale.radius.panel}px;
  --font-forge-editorial: Georgia, 'Times New Roman', serif;`;
// `.dark` is NYC-Tron's NightScope on web (Uniwind ScopedTheme's class), so a
// night surface inside a light page keeps the dark values. It follows the
// light block so it wins at equal specificity.
const output = `/* Generated from theme.ts; do not edit. Tailwind v4 semantic tokens. */\n@theme {\n${rules('dark')}\n${metrics}\n${declare(added.shared)}\n${declare(added.dark)}\n}\n[data-theme="light"] {\n${rules('light')}\n${declare(added.light)}\n}\n.dark {\n${rules('dark')}\n${declare(added.dark)}\n}\n${densityBlocks}`;
writeFileSync(new URL('./src/theme.css', import.meta.url), output);

const nativeOutput = `/* Generated from theme.ts; do not edit. Uniwind native variants. */
@theme {
${metrics}
${declare(added.shared)}
}
@layer theme {
  :root {
    @variant light {
${rules('light')}
${declare(added.light)}
    }
    @variant dark {
${rules('dark')}
${declare(added.dark)}
    }
  }
}
`;
writeFileSync(new URL('./src/theme.native.css', import.meta.url), nativeOutput);
