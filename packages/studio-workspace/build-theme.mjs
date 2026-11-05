import { writeFileSync } from 'node:fs';
import { workspaceThemes, workspaceScale } from './src/theme.ts';
const names = { base: 'surface', raised: 'raised', deep: 'mat', line: 'border', text: 'text', muted: 'muted', accent: 'accent', ink: 'on-accent', soft: 'tint', paper: 'paper', paperInk: 'paper-ink', paperMuted: 'paper-muted', error: 'error' };
const rules = values => Object.entries(values).map(([key, value]) => `  --color-forge-${names[key]}: ${value};`).join('\n');
const output = `/* Generated from theme.ts; do not edit. Tailwind v4 semantic tokens. */\n@theme {\n${rules(workspaceThemes.dark)}\n  --spacing-forge-target: ${workspaceScale.size.target}px;\n  --radius-sm: ${workspaceScale.radius.control}px;\n  --radius-forge-control: ${workspaceScale.radius.control}px;\n  --radius-control: ${workspaceScale.radius.control}px;\n  --font-forge-editorial: Georgia, 'Times New Roman', serif;\n}\n[data-theme="light"] {\n${rules(workspaceThemes.light)}\n}\n`;
writeFileSync(new URL('./src/theme.css', import.meta.url), output);

const nativeOutput = `/* Generated from theme.ts; do not edit. Uniwind native variants. */
@theme {
  --spacing-forge-target: ${workspaceScale.size.target}px;
  --radius-sm: ${workspaceScale.radius.control}px;
  --radius-forge-control: ${workspaceScale.radius.control}px;
  --radius-control: ${workspaceScale.radius.control}px;
  --font-forge-editorial: Georgia, 'Times New Roman', serif;
}
@layer theme {
  :root {
    @variant light {
${rules(workspaceThemes.light)}
    }
    @variant dark {
${rules(workspaceThemes.dark)}
    }
  }
}
`;
writeFileSync(new URL('./src/theme.native.css', import.meta.url), nativeOutput);
