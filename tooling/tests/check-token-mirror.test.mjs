import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkTokenMirror, compareMirror } from "../check-token-mirror.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the editor-controls token mirror matches studio-workspace", async () => {
  assert.deepEqual(await checkTokenMirror(root), []);
});

test("a changed, missing or unknown mirrored token is reported", () => {
  const source = { spacing: { fixedStack: 4, off6: 6 }, fontWeight: { bold: "700" } };
  assert.deepEqual(compareMirror({ spacing: { fixedStack: 4 } }, source), []);
  assert.deepEqual(compareMirror({ spacing: { fixedStack: 5 } }, source), ["spacing.fixedStack: mirror has 5, packages/studio-workspace/src/tokens.ts has 4"]);
  assert.deepEqual(compareMirror({ spacing: { off7: 7 } }, source), ["spacing.off7: no such token in packages/studio-workspace/src/tokens.ts"]);
  assert.deepEqual(compareMirror({ radius: { control: 4 } }, source), ["radius: no such group in packages/studio-workspace/src/tokens.ts"]);
  assert.deepEqual(compareMirror({ fontWeight: { bold: 700 } }, source), ["fontWeight.bold: mirror has 700, packages/studio-workspace/src/tokens.ts has \"700\""]);
});
