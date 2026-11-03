import { writeFileSync } from 'node:fs';
import { workspaceThemes, workspaceScale } from './src/theme.ts';
const names = { base: 'surface', raised: 'raised', deep: 'mat', line: 'border', text: 'text', muted: 'muted', accent: 'accent', ink: 'on-accent', soft: 'tint', paper: 'paper', paperInk: 'paper-ink', paperMuted: 'paper-muted', error: 'error' };
const rules = values => Object.entries(values).map(([key, value]) => `  --color-forge-${names[key]}: ${value};`).join('\n');
const output = `/* Generated from theme.ts; do not edit. Tailwind v4 semantic tokens. */\n@theme {\n${rules(workspaceThemes.dark)}\n  --spacing-forge-target: ${workspaceScale.size.target}px;\n  --radius-forge-control: ${workspaceScale.radius.control}px;\n  --font-forge-editorial: Georgia, 'Times New Roman', serif;\n}\n[data-theme="light"] {\n${rules(workspaceThemes.light)}\n}\n`;
writeFileSync(new URL('./src/theme.css', import.meta.url), output);
