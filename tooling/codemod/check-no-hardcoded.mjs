#!/usr/bin/env node
// CI gate: no hard-coded colour or numeric style literal in packages/*/src
// (decisions 6, 7, 38). Scope is TS, TSX, JS and JSX under packages/*/src.
// Out of scope: apps/* (decision 7), native Kotlin and Swift (decision 38),
// tests, declaration files, token files, and the files listed with a reason in
// allowlist.json `exemptFiles`.
//
// What this gate means by "no hard-coded values" (the definition every doc points at). A finding is
//   - kind colour:    a string literal that contains a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa) or a literal `rgb(`/`rgba(`/`hsl(` call, or
//   - kind number:    a non-zero numeric literal that is, or sits in a ternary or arithmetic branch of, the value of a style
//                     property (width, padding, gap, fontSize, borderRadius, zIndex, opacity ...). `opacity: 1` is the identity
//                     and is not a finding. Neither is the divisor in `x / 2`, nor a unit 1 added to or subtracted from
//                     a factor of a product or quotient (`(1 - t) * length`, `(x + 1) / 2`, `(last - first + 1) * row`),
//                     which is a fraction or a count, not a length.
//   - kind prop:      a non-zero numeric literal given to a JSX numeric prop (size, width, height, strokeWidth, fontSize, r, rx, ry),
//                     including both branches of a ternary.
//   - kind tailwind:  a Tailwind arbitrary value with a length unit or a colour inside a class string (`rounded-[4px]`,
//                     `shadow-[0_1px_2px_#252A3A26]`, `min-h-[44px]`). `[var(--x)]` and unitless arbitrary values are not findings.
//   - kind offset:    a numeric literal added to or subtracted from an expression inside a type-scale call `fs(...)`
//                     (`fs(scale.type.label + 1)`).
// Not covered, so a grep can still find numbers here: SVG geometry (cx, cy, x, y, points, viewBox, path data), array
// and object data that is not a style property, native Kotlin and Swift, apps/*, and tests. The count the gate reports
// is the count under this definition, not a claim about every number in the packages.
// Findings in allowlist.json `entries` are reported as allowed, each with its reason. An entry that
// matches nothing is stale and fails the run, so the list cannot rot.
//
//   node tooling/codemod/check-no-hardcoded.mjs [--json out.json] [--list] [--packages a,b]
// Exit code 1 on an unallowed finding or a stale allowlist entry.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSX_NUMERIC_PROPS, STYLE_PROPS, TOKEN_FILES, isTestFile, listSources, loadTsMorph, numericPartsOf, readJson, repoRoot } from './lib.mjs';
import { readdirSync } from 'node:fs';

const { Project, SyntaxKind, Node } = loadTsMorph();
const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const jsonOut = flag('--json');
const onlyPackages = flag('--packages')?.split(',') ?? null;
const listAll = args.includes('--list');

const config = readJson(join(repoRoot, 'tooling/codemod/allowlist.json'));
const exempt = new Map(config.exemptFiles.map(entry => [entry.path, entry.reason]));

/** Tailwind arbitrary value whose bracket holds a length unit or a colour. */
const tailwindArbitrary = /(?:^|[\s"'`:!])(-?[a-z][a-z0-9-]*-\[[^\]\s]*(?:\d(?:\.\d+)?(?:px|rem|em|vh|vw)|#[0-9a-fA-F]{3,8}|rgba?\()[^\]\s]*\])/g;
const hexInString = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
const colourCall = /\b(?:rgba?|hsla?)\(\s*[0-9.]/;

const packages = readdirSync(join(repoRoot, 'packages')).filter(name => { try { return readdirSync(join(repoRoot, 'packages', name, 'src')).length > 0; } catch { return false; } });
const prefixes = packages.filter(name => !onlyPackages || onlyPackages.includes(name)).map(name => `packages/${name}/src`);
const files = listSources(prefixes, /\.(tsx?|jsx?)$/);

const findings = [];
let scanned = 0;
const skipped = { tests: 0, tokenFiles: 0, exempt: [] };
const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });

const numericParts = numericPartsOf({ Node, SyntaxKind });

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
      for (const m of text.matchAll(tailwindArbitrary)) add(node, 'tailwind', m[1].slice(0, m[1].indexOf('-[')), m[1]);
      if (hexInString.test(text) || colourCall.test(text)) add(node, 'colour', Node.isPropertyAssignment(parent) ? parent.getName() : '-', text.length > 60 ? `${text.slice(0, 57)}...` : text);
    } else if (Node.isTemplateExpression(node)) {
      const text = [node.getHead().getLiteralText(), ...node.getTemplateSpans().map(span => span.getLiteral().getLiteralText())].join('');
      if (hexInString.test(text)) add(node, 'colour', '-', text);
    } else if (Node.isJsxAttribute(node)) {
      const name = node.getNameNode().getText();
      if (!JSX_NUMERIC_PROPS.has(name)) return;
      const initializer = node.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer) || !initializer.getExpression()) return;
      for (const part of numericParts(initializer.getExpression())) {
        const value = Number(part.getText());
        if (value === 0) continue;
        add(part, 'prop', name, `${Node.isPrefixUnaryExpression(part.getParent()) ? '-' : ''}${part.getText()}`);
      }
    } else if (Node.isCallExpression(node) && node.getExpression().getText() === 'fs') {
      for (const argument of node.getArguments()) {
        for (const part of numericParts(argument)) {
          const value = Number(part.getText());
          if (value === 0) continue;
          add(part, 'offset', 'fs()', `${Node.isPrefixUnaryExpression(part.getParent()) ? '-' : ''}${part.getText()}`);
        }
      }
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
        if (name === 'opacity' && value === 1) continue;
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
