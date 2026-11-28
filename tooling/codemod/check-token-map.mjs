#!/usr/bin/env node
// Checks tokens.ts (through its CSS projection) against docs/agent-native/tokens.map.json:
// every token the map defines must be declared with the identical value, and
// every token tokens.ts declares must be in the map or be a minted off-scale
// twin named by a migration row. Prints the gaps; exits 1 on a mismatch.
import { readFileSync } from 'node:fs';
import { cssTokens } from '../../packages/studio-workspace/src/tokens.ts';

const map = JSON.parse(readFileSync(new URL('../../docs/agent-native/tokens.map.json', import.meta.url), 'utf8'));
const css = cssTokens();
const norm = text => String(text).replace(/#[0-9a-f]{3,8}\b/gi, hex => hex.toUpperCase()).replace(/\s+/g, ' ').trim();
const shared = new Map(css.shared.map(d => [d.name, d.value]));
const dark = new Map(css.dark.map(d => [d.name, d.value]));
const light = new Map(css.light.map(d => [d.name, d.value]));
const densityValue = (density, name) => css.density[density]?.find(d => d.name === name)?.value ?? shared.get(name);
const skippedExisting = new Set(['existing-nyc-tron', 'existing-css-keep (AGENTS.md rounded-sm 4px)']);
const problems = [];
const notes = { checked: 0, skippedExisting: 0, skippedUndefined: [], skippedEmpty: [] };
const covered = new Set();

for (const token of map.tokens) {
  if (skippedExisting.has(token.status)) { notes.skippedExisting++; continue; }
  if (token.status === 'reserved-value-undefined-in-repo') { notes.skippedUndefined.push(token.name); continue; }
  if (token.values) {
    covered.add(token.name);
    for (const density of ['compact', 'standard', 'comfortable']) {
      const got = densityValue(density, token.name);
      if (norm(got) !== `${token.values[density]}px`) problems.push(`${token.name} ${density}: ${got} != ${token.values[density]}px`);
    }
    notes.checked++;
    continue;
  }
  if ('dark' in token && token.dark === '' ) { notes.skippedEmpty.push(token.name); continue; }
  covered.add(token.name);
  if ('value' in token) {
    const got = shared.get(token.name);
    if (got === undefined || norm(got) !== norm(token.value)) problems.push(`${token.name}: ${got} != ${token.value}`);
  } else if (token.dark === token.light) {
    const got = shared.get(token.name);
    if (got === undefined || norm(got) !== norm(token.dark)) problems.push(`${token.name}: ${got} != ${token.dark}`);
  } else {
    if (norm(dark.get(token.name)) !== norm(token.dark)) problems.push(`${token.name} dark: ${dark.get(token.name)} != ${token.dark}`);
    if (norm(light.get(token.name)) !== norm(token.light)) problems.push(`${token.name} light: ${light.get(token.name)} != ${token.light}`);
  }
  notes.checked++;
}

const minted = new Set();
for (const row of map.migrations) if (row.kind === 'literal' && typeof row.to === 'string' && row.to.includes('-off-')) minted.add(row.to);
const declared = new Set([...shared.keys(), ...dark.keys(), ...light.keys()]);
const densityNames = new Set(map.tokens.filter(t => t.values).map(t => t.name));
const extras = [...declared].filter(name => !covered.has(name) && !minted.has(name) && !densityNames.has(name));
const mintedMissing = [...minted].filter(name => !declared.has(name));
for (const name of extras) problems.push(`declared but not in the map: ${name}`);
for (const name of mintedMissing) problems.push(`migration names ${name} but tokens.ts does not declare it`);

console.log(`map tokens checked: ${notes.checked}; already in the old CSS (not re-declared): ${notes.skippedExisting}`);
console.log(`not declared, no value in the repo: ${notes.skippedUndefined.join(', ') || 'none'}`);
console.log(`not declared, empty value: ${notes.skippedEmpty.join(', ') || 'none'}`);
console.log(`off-scale twins minted from migration rows (absent from map tokens[]): ${minted.size}`);
console.log(`declarations: shared ${css.shared.length}, dark ${css.dark.length}, light ${css.light.length}`);
console.log(problems.length ? `MISMATCH (${problems.length})\n  ${problems.join('\n  ')}` : 'tokens.ts matches tokens.map.json');
process.exit(problems.length ? 1 : 0);
