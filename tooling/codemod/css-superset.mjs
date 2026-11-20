#!/usr/bin/env node
// Proves a regenerated CSS file is a pure superset of an older one: for each
// block (selector path), every declaration of the old file exists in the new
// file with the identical value. Added declarations and blocks are counted.
//
//   node tooling/codemod/css-superset.mjs <old.css> <new.css>
//   node tooling/codemod/css-superset.mjs --git <ref> <path>   (old = git show <ref>:<path>, new = working tree)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Parse `selector { name: value; }` blocks, including one level of nesting (`@layer`, `:root`, `@variant`). */
export function parseBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map();
  const stack = [];
  let buffer = '';
  const add = (path, name, value) => {
    const key = path.join(' > ');
    if (!blocks.has(key)) blocks.set(key, new Map());
    const map = blocks.get(key);
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(value);
  };
  for (const ch of text) {
    if (ch === '{') { stack.push(buffer.trim()); buffer = ''; }
    else if (ch === '}') { flush(); stack.pop(); }
    else if (ch === ';') flush();
    else buffer += ch;
  }
  function flush() {
    const declaration = buffer.trim();
    buffer = '';
    if (!declaration) return;
    const colon = declaration.indexOf(':');
    if (colon < 0) return;
    add(stack, declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return blocks;
}

export function compare(oldCss, newCss) {
  const before = parseBlocks(oldCss);
  const after = parseBlocks(newCss);
  const problems = [];
  let kept = 0;
  let added = 0;
  for (const [block, declarations] of before) {
    const next = after.get(block);
    for (const [name, values] of declarations) {
      const found = next?.get(name);
      if (!found) { problems.push(`missing in ${block}: ${name}`); continue; }
      if (JSON.stringify(found.slice(0, values.length)) !== JSON.stringify(values)) problems.push(`changed in ${block}: ${name}: ${values.join(' | ')} -> ${found.join(' | ')}`);
      else kept += values.length;
    }
  }
  for (const [block, declarations] of after) {
    for (const [name, values] of declarations) {
      const old = before.get(block)?.get(name)?.length ?? 0;
      added += values.length - old;
    }
  }
  return { kept, added, oldDeclarations: [...before.values()].reduce((n, m) => n + [...m.values()].reduce((k, v) => k + v.length, 0), 0), problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let oldCss, newCss, label;
  if (args[0] === '--git') {
    oldCss = execFileSync('git', ['show', `${args[1]}:${args[2]}`], { encoding: 'utf8' });
    newCss = readFileSync(args[2], 'utf8');
    label = args[2];
  } else {
    oldCss = readFileSync(args[0], 'utf8');
    newCss = readFileSync(args[1], 'utf8');
    label = args[1];
  }
  const result = compare(oldCss, newCss);
  console.log(`${label}: old declarations ${result.oldDeclarations}, kept identical ${result.kept}, added ${result.added}, violations ${result.problems.length}`);
  for (const problem of result.problems) console.log(`  ${problem}`);
  process.exit(result.problems.length ? 1 : 0);
}
