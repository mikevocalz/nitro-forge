// Minimal fixture generator: writes the radius block the real build-theme.mjs writes.
import { writeFileSync } from 'node:fs';
import { forgeRadius, workspaceScale } from './src/theme.ts';
const radii = `  --radius-sm: ${forgeRadius.sm}px;
  --radius-md: ${forgeRadius.md}px;
  --radius-forge-control: ${workspaceScale.radius.control}px;
  --radius-control: ${workspaceScale.radius.control}px;
  --radius-card: ${workspaceScale.radius.panel}px;`;
for (const name of ['theme.css', 'theme.native.css', 'radius.css']) {
  writeFileSync(new URL(`./src/${name}`, import.meta.url), `@theme {\n${radii}\n}\n`);
}
