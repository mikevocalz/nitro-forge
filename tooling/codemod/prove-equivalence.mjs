#!/usr/bin/env node
// Static equivalence proof for the tokenization rewrite (decision 40).
//
// For every source file in packages/studio-workspace/src and packages/icons/src:
//   1. take the file as it was on the base ref (default origin/master) and as
//      it is now,
//   2. on both sides, replace every token reference with the literal value
//      that token holds on that side (each side's tokens.ts and icons tokens.js
//      are loaded and read, not copied) and drop the token-root imports,
//   3. print both syntax trees with the TypeScript printer and compare them.
// Substituting both sides matters once the base is itself tokenized (a PR into
// a branch that already holds the rewrite): a reference that is the same on
// both sides then reads as the same literal instead of a false difference.
// A file passes when the two printed trees are identical. Comments are not
// part of the comparison; literal spelling is normalised (`.4` and `0.4`,
// single and double quotes) because it does not change the value.
//
// What this proves: the rewritten code is the same code once token references
// are read back as their values. What it does not prove: that any screen
// renders the same. It does not render anything, and it trusts the token values
// (tokens.ts against tokens.map.json is checked by check-token-map.mjs).
//
//   node tooling/codemod/prove-equivalence.mjs [--base origin/master] [--json out.json] [--verbose]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGES, TOKEN_FILES, git, listSources, loadTokenModules, loadTsMorph, packageOf, repoRoot } from './lib.mjs';

const { Project, ts } = loadTsMorph();
const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const base = flag('--base') ?? 'origin/master';
const jsonOut = flag('--json');
const verbose = args.includes('--verbose');

const modules = await loadTokenModules();
/** The base ref's token modules, read from a copy of its two source trees. */
const baseTree = mkdtempSync(join(tmpdir(), 'prove-equivalence-'));
let baseModules;
try {
  const archive = execFileSync('git', ['archive', base, 'packages/studio-workspace/src', 'packages/icons/src'], { cwd: repoRoot, maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', baseTree], { input: archive });
  baseModules = await loadTokenModules(baseTree);
} catch (error) {
  // A base without the token modules (before the rewrite) has no references to read back.
  console.error(`base ${base}: no token modules loaded (${error.message.split("\n")[0]}); comparing its references as written`);
  baseModules = null;
} finally {
  rmSync(baseTree, { recursive: true, force: true });
}
/** Names a package's token module exports that code reads as `name.a.b`. */
const ROOTS = {
  'packages/studio-workspace/src': new Set(['tokens']),
  'packages/icons/src': new Set(['iconLayout', 'iconSurface', 'iconSpring', 'iconOpacity']),
};
const MODULE_SPECIFIER = { 'packages/studio-workspace/src': './tokens', 'packages/icons/src': './tokens.js' };

const f = ts.factory;
const FOLD = new Map([
  [ts.SyntaxKind.PlusToken, (a, b) => a + b],
  [ts.SyntaxKind.MinusToken, (a, b) => a - b],
  [ts.SyntaxKind.AsteriskToken, (a, b) => a * b],
  [ts.SyntaxKind.SlashToken, (a, b) => a / b],
]);
/** The number a literal (or a negated literal) holds, or null. */
const numberOf = node => {
  if (ts.isParenthesizedExpression(node)) return numberOf(node.expression);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  return null;
};
const literalFor = value => {
  if (typeof value === 'string') return f.createStringLiteral(value, true);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite token value ${value}`);
    return value < 0 ? f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(String(-value))) : f.createNumericLiteral(String(value));
  }
  throw new Error(`token resolves to a ${typeof value}, not a literal`);
};

function importedNames(sourceFile, specifier) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === specifier) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

/** Parse, optionally substitute token references, normalise literal spelling, print. */
function render(text, file, { modules }) {
  const substitute = modules !== null;
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve } });
  const sourceFile = project.createSourceFile(file, text, { overwrite: true }).compilerNode;
  const pkg = packageOf(file);
  const roots = ROOTS[pkg];
  const specifier = MODULE_SPECIFIER[pkg];
  const localRoots = substitute ? new Set([...importedNames(sourceFile, specifier)].filter(name => roots.has(name))) : new Set();
  const problems = [];
  let substitutions = 0;

  const transformer = context => {
    const visit = node => {
      if (substitute && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === specifier) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          const keep = bindings.elements.filter(element => !roots.has(element.name.text));
          if (keep.length === 0) return undefined;
          if (keep.length !== bindings.elements.length) {
            return f.updateImportDeclaration(node, node.modifiers, f.updateImportClause(node.importClause, node.importClause.isTypeOnly, node.importClause.name, f.updateNamedImports(bindings, keep)), f.createStringLiteral(node.moduleSpecifier.text, true), node.attributes);
          }
        }
        return node;
      }
      // Widening only: `tokens.x as number|string` keeps a const-typed token from narrowing a
      // store or default parameter that the original literal left as number|string. The
      // assertion is erased at runtime, so the proof reads it as the literal alone.
      if (substitute && ts.isAsExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && (node.type.kind === ts.SyntaxKind.NumberKeyword || node.type.kind === ts.SyntaxKind.StringKeyword)) {
        const inner = visit(node.expression);
        if (ts.isNumericLiteral(inner) || ts.isStringLiteral(inner)) return inner;
      }
      if (substitute && ts.isPropertyAccessExpression(node)) {
        const path = [];
        let current = node;
        while (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.name)) { path.unshift(current.name.text); current = current.expression; }
        if (ts.isIdentifier(current) && localRoots.has(current.text) && path.length) {
          let value = pkg === 'packages/studio-workspace/src' ? modules[pkg].tokens : modules[pkg];
          const trail = pkg === 'packages/studio-workspace/src' ? path : [current.text, ...path];
          for (const key of trail) value = value?.[key];
          try {
            const literal = literalFor(value);
            substitutions += 1;
            return literal;
          } catch (error) {
            problems.push(`${current.text}.${path.join('.')}: ${error.message}`);
            return node;
          }
        }
      }
      // Arithmetic on two numbers folds to its result on both sides, so `tokens.spacing.off16 / 2`
      // and a base `8` compare equal. Only + - * / with numeric operands fold; anything else stays.
      if (ts.isBinaryExpression(node) && FOLD.has(node.operatorToken.kind)) {
        const left = visit(node.left);
        const right = visit(node.right);
        const a = numberOf(left);
        const b = numberOf(right);
        if (a !== null && b !== null) {
          const value = FOLD.get(node.operatorToken.kind)(a, b);
          if (Number.isFinite(value)) return literalFor(value);
        }
        return f.updateBinaryExpression(node, left, node.operatorToken, right);
      }
      if (ts.isNumericLiteral(node)) return f.createNumericLiteral(String(Number(node.text)));
      if (ts.isStringLiteral(node)) return f.createStringLiteral(node.text, true);
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  };

  const result = ts.transform(sourceFile, [transformer]);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const out = printer.printFile(result.transformed[0]);
  result.dispose();
  return { out, problems, substitutions };
}

function firstDifference(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) if (left[i] !== right[i]) return `line ${i + 1}\n  base:  ${left[i] ?? '(missing)'}\n  head:  ${right[i] ?? '(missing)'}`;
  return 'identical';
}

const files = listSources();
const rows = [];
let diffs = 0;
let substitutions = 0;
for (const file of files) {
  const head = readFileSync(join(repoRoot, file), 'utf8');
  let baseText = null;
  try { baseText = git('show', `${base}:${file}`); } catch { baseText = null; }
  if (TOKEN_FILES.has(file)) { rows.push({ file, status: 'token-file-exempt', changed: baseText !== head }); continue; }
  if (baseText === null) { rows.push({ file, status: 'new-file', changed: true }); continue; }
  if (baseText === head) { rows.push({ file, status: 'unchanged', changed: false }); continue; }
  const pkg = packageOf(file);
  const before = render(baseText, file, { modules: baseModules });
  const after = render(head, file, { modules });
  substitutions += after.substitutions;
  const equal = before.out === after.out && before.problems.length === 0 && after.problems.length === 0;
  if (!equal) diffs += 1;
  rows.push({ file, status: equal ? 'equivalent' : 'DIFF', changed: true, substitutions: after.substitutions, problems: [...before.problems.map(problem => `base: ${problem}`), ...after.problems], detail: equal ? undefined : firstDifference(before.out, after.out) });
}

const changed = rows.filter(row => row.changed && row.status !== 'token-file-exempt');
const summary = {
  base,
  filesScanned: rows.length,
  filesUnchanged: rows.filter(row => row.status === 'unchanged').length,
  tokenFilesExempt: rows.filter(row => row.status === 'token-file-exempt').map(row => row.file),
  newFilesNotCompared: rows.filter(row => row.status === 'new-file').map(row => row.file),
  filesChanged: changed.filter(row => row.status !== 'new-file').length,
  referencesSubstituted: substitutions,
  diffs,
  result: diffs === 0 ? 'PASS: zero diffs' : 'FAIL',
  note: 'Proves code equivalence modulo token values (every token reference replaced by the literal it holds, printed AST equal to the base ref). It does not prove rendered pixels.',
};
console.log(JSON.stringify(summary, null, 2));
for (const row of rows) if (row.status === 'DIFF' || row.status === 'new-file' || verbose) console.log(`${row.status.padEnd(10)} ${row.file}${row.substitutions !== undefined ? ` (${row.substitutions} refs)` : ''}${row.detail ? `\n  ${row.detail}` : ''}${row.problems?.length ? `\n  ${row.problems.join('\n  ')}` : ''}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, rows }, null, 2));
process.exit(diffs === 0 ? 0 : 1);
