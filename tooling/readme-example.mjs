/**
 * Keeps the usage example in a package README runnable.
 *
 * A README marks its example with `<!-- readme-example -->` on the line
 * before a ```ts fence. The same code is committed as
 * `packages/<pkg>/tests/readme-example.ts`, so `pnpm typecheck` checks it, and
 * the package's `tests/readme-example.e2e.test.ts` runs it against the real
 * engines through nf-cli.
 *
 * Every `console.log(...)` line in the example ends with `// <value>`, the
 * value it prints. The test compares the printed values with those comments.
 *
 *   node tooling/readme-example.mjs --check   # fail if a copy is out of date
 *   node tooling/readme-example.mjs --write   # rewrite the copies from the READMEs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "<!-- readme-example -->";

/** The code inside the fenced block that follows the marker. */
export function extractReadmeExample(readme) {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  const markers = lines.flatMap((line, i) => (line.trim() === MARKER ? [i] : []));
  if (markers.length !== 1) throw new Error(`expected exactly one ${MARKER} line, found ${markers.length}`);
  const open = markers[0] + 1;
  if (!/^```(ts|typescript)\s*$/.test(lines[open] ?? "")) {
    throw new Error(`${MARKER} must be followed directly by a \`\`\`ts fence`);
  }
  const close = lines.findIndex((line, i) => i > open && /^```\s*$/.test(line));
  if (close < 0) throw new Error("unterminated example fence");
  return lines.slice(open + 1, close).join("\n") + "\n";
}

/** The values the example's `console.log` lines say they print, in order. */
export function expectedLogs(code) {
  return code.split("\n").flatMap((line, i) => {
    if (!/\bconsole\.log\(/.test(line)) return [];
    const match = /\/\/\s*(.+?)\s*$/.exec(line);
    if (!match) throw new Error(`example line ${i + 1}: console.log needs a trailing // <value> comment`);
    return [match[1]];
  });
}

/** How a logged value is compared with its comment: strings as-is, the rest as JSON. */
export function formatLogged(args) {
  return args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" ");
}

/** Throws unless `copyPath` holds exactly the README's example. Returns the expected log values. */
export function checkReadmeExample(readmePath, copyPath) {
  const code = extractReadmeExample(readFileSync(readmePath, "utf8"));
  const copy = existsSync(copyPath) ? readFileSync(copyPath, "utf8") : null;
  if (copy !== code) {
    throw new Error(
      `${fileURLToPath(copyPath)} does not match the example in ${fileURLToPath(readmePath)}. ` +
        "Run `node tooling/readme-example.mjs --write`.",
    );
  }
  return expectedLogs(code);
}

function packagesWithExamples(root) {
  return readdirSync(join(root, "packages")).filter((dir) => {
    const readme = join(root, "packages", dir, "README.md");
    return existsSync(readme) && readFileSync(readme, "utf8").includes(MARKER);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--write") {
    console.error("usage: node tooling/readme-example.mjs --check | --write");
    process.exit(2);
  }
  let stale = 0;
  for (const dir of packagesWithExamples(root)) {
    const code = extractReadmeExample(readFileSync(join(root, "packages", dir, "README.md"), "utf8"));
    expectedLogs(code);
    const copy = join(root, "packages", dir, "tests", "readme-example.ts");
    const current = existsSync(copy) ? readFileSync(copy, "utf8") : null;
    if (current === code) continue;
    if (mode === "--write") {
      writeFileSync(copy, code);
      console.log(`wrote packages/${dir}/tests/readme-example.ts`);
    } else {
      console.error(`stale: packages/${dir}/tests/readme-example.ts`);
      stale++;
    }
  }
  if (stale) {
    console.error("Run `node tooling/readme-example.mjs --write`.");
    process.exit(1);
  }
}
