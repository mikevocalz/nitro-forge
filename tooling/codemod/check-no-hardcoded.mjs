#!/usr/bin/env node
// CI gate: no hard-coded colour or numeric style literal in packages/*/src
// (decisions 6, 7, 38). Scope is TS, TSX, JS and JSX under packages/*/src.
// Out of scope: apps/* (decision 7), native Kotlin and Swift (decision 38),
// tests, declaration files, token files, and the files listed with a reason in
// allowlist.json `exemptFiles`.
//
// A finding is
//   - a string literal that contains a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa) or a literal `rgb(`/`rgba(`/`hsl(` call, or
//   - a non-zero numeric literal that is, or sits in a ternary or arithmetic branch of, the value of a style property
//     (width, padding, gap, fontSize, borderRadius, zIndex, opacity ...).
// Findings in allowlist.json `entries` are reported as allowed, each with its reason. An entry that
// matches nothing is stale and fails the run, so the list cannot rot.
//
//   node tooling/codemod/check-no-hardcoded.mjs [--json out.json] [--list] [--packages a,b]
// Exit code 1 on an unallowed finding or a stale allowlist entry.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKEN_FILES, isTestFile, listSources, loadTsMorph, readJson, repoRoot } from './lib.mjs';
import { readdirSync } from 'node:fs';

const { Project, SyntaxKind, Node } = loadTsMorph();
const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const jsonOut = flag('--json');
const onlyPackages = flag('--packages')?.split(',') ?? null;
const listAll = args.includes('--list');

const config = readJson(join(repoRoot, 'tooling/codemod/allowlist.json'));
const exempt = new Map(config.exemptFiles.map(entry => [entry.path, entry.reason]));

const STYLE_PROPS = new Set([
  'left', 'right', 'top', 'bottom', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingHorizontal', 'paddingVertical',
  'gap', 'rowGap', 'columnGap', 'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'fontSize', 'lineHeight', 'letterSpacing', 'zIndex', 'opacity', 'hitSlop', 'outlineWidth', 'outlineOffset',
  'shadowRadius', 'shadowOpacity', 'elevation', 'flexBasis', 'fontWeight',
]);
const hexInString = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
const colourCall = /\b(?:rgba?|hsla?)\(\s*[0-9.]/;

const packages = readdirSync(join(repoRoot, 'packages')).filter(name => { try { return readdirSync(join(repoRoot, 'packages', name, 'src')).length > 0; } catch { return false; } });
const prefixes = packages.filter(name => !onlyPackages || onlyPackages.includes(name)).map(name => `packages/${name}/src`);
const files = listSources(prefixes, /\.(tsx?|jsx?)$/);

const findings = [];
let scanned = 0;
const skipped = { tests: 0, tokenFiles: 0, exempt: [] };
const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });

const nodeValue = node => Node.isNumericLiteral(node) ? Number(node.getText()) : null;
/** Numeric literals that are the value, or a ternary or arithmetic branch of the value. */
function* numericParts(node) {
  if (Node.isNumericLiteral(node)) yield node;
  else if (Node.isPrefixUnaryExpression(node) && Node.isNumericLiteral(node.getOperand())) yield node.getOperand();
  else if (Node.isParenthesizedExpression(node)) yield* numericParts(node.getExpression());
  else if (Node.isAsExpression(node)) yield* numericParts(node.getExpression());
  else if (Node.isConditionalExpression(node)) { yield* numericParts(node.getWhenTrue()); yield* numericParts(node.getWhenFalse()); }
  else if (Node.isBinaryExpression(node)) {
    // `x / 2` and `x % 3` are ratios, not lengths: only the left side can carry a literal length.
    const operator = node.getOperatorToken().getKind();
    yield* numericParts(node.getLeft());
    if (operator !== SyntaxKind.SlashToken && operator !== SyntaxKind.PercentToken) yield* numericParts(node.getRight());
  }
}

for (const file of files) {
  if (isTestFile(file)) { skipped.tests += 1; continue; }
  if (TOKEN_FILES.has(file) || /\/(tokens|theme)\.(ts|js)$/.test(file)) { skipped.tokenFiles += 1; continue; }
  if (exempt.has(file)) { skipped.exempt.push(file); continue; }
  scanned += 1;
  const source = project.createSourceFile(file, readFileSync(join(repoRoot, file), 'utf8'), { overwrite: true });
  const add = (node, kind, property, value) => {
    const { line } = source.getLineAndColumnAtPos(node.getStart());
    findings.push({ file, line, kind, property, value: String(value) });
  };
  source.forEachDescendant(node => {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.getLiteralText();
      const parent = node.getParent();
      if (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent)) return;
      if (hexInString.test(text) || colourCall.test(text)) add(node, 'colour', Node.isPropertyAssignment(parent) ? parent.getName() : '-', text.length > 60 ? `${text.slice(0, 57)}...` : text);
    } else if (Node.isTemplateExpression(node)) {
      const text = [node.getHead().getLiteralText(), ...node.getTemplateSpans().map(span => span.getLiteral().getLiteralText())].join('');
      if (hexInString.test(text)) add(node, 'colour', '-', text);
    } else if (Node.isPropertyAssignment(node)) {
      const nameNode = node.getNameNode();
      const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : node.getName();
      if (!STYLE_PROPS.has(name)) return;
      const initializer = node.getInitializer();
      if (!initializer) return;
      if (name === 'fontWeight' && Node.isStringLiteral(initializer) && /^\d+$/.test(initializer.getLiteralText())) { add(initializer, 'number', name, initializer.getLiteralText()); return; }
      for (const part of numericParts(initializer)) {
        const value = Number(part.getText());
        if (value === 0) continue;
        const negative = Node.isPrefixUnaryExpression(part.getParent());
        add(part, 'number', name, `${negative ? '-' : ''}${part.getText()}`);
      }
    }
  });
}

// ---- match against the allowlist ----
const budget = config.entries.map(entry => ({ ...entry, used: 0 }));
const violations = [];
const allowed = [];
for (const finding of findings) {
  const entry = budget.find(candidate => candidate.file === finding.file && candidate.kind === finding.kind && candidate.property === finding.property && String(candidate.value) === finding.value && candidate.used < (candidate.count ?? 1));
  if (entry) { entry.used += 1; allowed.push({ ...finding, reason: entry.reason }); } else violations.push(finding);
}
const stale = budget.filter(entry => !onlyPackages && entry.used !== (entry.count ?? 1));

const byPackage = {};
for (const finding of findings) {
  const pkg = finding.file.split('/')[1];
  byPackage[pkg] ??= { findings: 0, allowed: 0, violations: 0 };
  byPackage[pkg].findings += 1;
}
for (const item of allowed) byPackage[item.file.split('/')[1]].allowed += 1;
for (const item of violations) byPackage[item.file.split('/')[1]].violations += 1;

const summary = {
  scope: 'packages/*/src TS, TSX, JS, JSX; excludes tests, token files, exempt files',
  filesScanned: scanned,
  skipped: { tests: skipped.tests, tokenFiles: skipped.tokenFiles, exemptFiles: skipped.exempt },
  findings: findings.length,
  allowed: allowed.length,
  violations: violations.length,
  staleAllowlistEntries: stale.length,
  byPackage,
};
console.log(JSON.stringify(summary, null, 2));
for (const item of violations) console.log(`VIOLATION ${item.file}:${item.line} ${item.kind} ${item.property}=${item.value}`);
for (const entry of stale) console.log(`STALE     ${entry.file} ${entry.kind} ${entry.property}=${entry.value} matched ${entry.used} of ${entry.count ?? 1}`);
if (listAll) console.log(JSON.stringify(findings, null, 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, violations, allowed, stale }, null, 2));
process.exit(violations.length || stale.length ? 1 : 0);
