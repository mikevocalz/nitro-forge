import { readFileSync, writeFileSync } from 'node:fs';
// node build-theme.mjs          write src/theme.css and src/theme.native.css
// node build-theme.mjs --check  write nothing; exit 1 when either file differs from what theme.ts and tokens.ts generate
const check = process.argv.includes('--check');
const drift = [];
const emit = (url, text) => {
  if (!check) return writeFileSync(url, text);
  let current = null;
  try { current = readFileSync(url, 'utf8'); } catch { /* missing counts as drift */ }
  if (current !== text) drift.push(url.pathname.split('/').slice(-1)[0]);
};
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
emit(new URL('./src/theme.css', import.meta.url), output);

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
emit(new URL('./src/theme.native.css', import.meta.url), nativeOutput);
if (check) {
  if (drift.length) {
    console.error(`build-theme --check: ${drift.join(', ')} differ from theme.ts and tokens.ts. Run pnpm --filter @nitro-forge/studio-workspace build:theme and commit.`);
    process.exit(1);
  }
  console.log('build-theme --check: theme.css and theme.native.css match theme.ts and tokens.ts');
}
