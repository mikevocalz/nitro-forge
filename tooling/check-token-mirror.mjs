#!/usr/bin/env node
// Token mirror check: packages/editor-controls/src/tokens.ts copies values from
// packages/studio-workspace/src/tokens.ts, because editor-controls cannot import
// studio-workspace (studio-workspace depends on it). This fails when the copy
// drifts: every group and key in the mirror's `tokens` must exist in
// studio-workspace's `tokens` with the identical value. The radius mirror
// (editor-controls/src/radius.ts) is checked by tooling/check-radius.mjs.
//
//   node tooling/check-token-mirror.mjs     prints each difference, exits 1 on any
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const MIRROR_FILE = "packages/editor-controls/src/tokens.ts";
export const SOURCE_FILE = "packages/studio-workspace/src/tokens.ts";

/** Differences between a mirror object and the source object it copies, as `group.key: detail` lines. */
export function compareMirror(mirror, source) {
  const problems = [];
  for (const [group, entries] of Object.entries(mirror)) {
    const from = source[group];
    if (!from || typeof from !== "object") { problems.push(`${group}: no such group in ${SOURCE_FILE}`); continue; }
    for (const [key, value] of Object.entries(entries)) {
      if (!(key in from)) problems.push(`${group}.${key}: no such token in ${SOURCE_FILE}`);
      else if (JSON.stringify(from[key]) !== JSON.stringify(value)) problems.push(`${group}.${key}: mirror has ${JSON.stringify(value)}, ${SOURCE_FILE} has ${JSON.stringify(from[key])}`);
    }
  }
  return problems;
}

export async function checkTokenMirror(rootDir) {
  const load = file => import(pathToFileURL(join(rootDir, file)).href);
  const [mirror, source] = await Promise.all([load(MIRROR_FILE), load(SOURCE_FILE)]);
  return compareMirror(mirror.tokens, source.tokens);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = await checkTokenMirror(root);
  for (const problem of problems) console.log(`DRIFT ${MIRROR_FILE} ${problem}`);
  console.log(`check-token-mirror: ${problems.length} difference(s)`);
  process.exitCode = problems.length ? 1 : 0;
}
