#!/usr/bin/env node
// Value-preserving tokenization codemod (decisions 6, 10, 40).
//
// Reads docs/agent-native/tokens.map.json and rewrites, in
// packages/studio-workspace/src and packages/icons/src, each hex colour and
// numeric style literal the map lists into a reference to a token that holds
// the identical value. Nothing is snapped: a literal with no matching token
// stays as it is. Zero literals, document constants, generated files, tests
// and the token files themselves are not touched.
//
//   node tooling/codemod/tokenize.mjs            dry run, prints the report
//   node tooling/codemod/tokenize.mjs --write    rewrite files in place
//   node tooling/codemod/tokenize.mjs --json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGES, TOKEN_FILES, canonNumber, isTestFile, loadMap, loadTokenIndex, loadTsMorph, packageOf, repoRoot } from './lib.mjs';

const { Project, SyntaxKind, Node } = loadTsMorph();
const write = process.argv.includes('--write');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const map = loadMap();
const { index } = await loadTokenIndex();

/** Icons package: the token module is plain JS and exports named objects, not one `tokens` root. */
const ICON_REFERENCES = {
  hitSlop: 'iconLayout.hitSlop',
  hitTarget: 'iconLayout.hitTarget',
  surfaceDark: 'iconSurface.dark',
  surfaceLight: 'iconSurface.light',
  opacityDisabled: 'iconOpacity.disabled',
  stiffness: 'iconSpring.stiffness',
  damping: 'iconSpring.damping',
  mass: 'iconSpring.mass',
};

const parseNumber = text => (text.startsWith('-') ? -1 : 1) * Number(text.replace(/^-/, ''));

/** Rows of the map this run can act on, grouped by file. */
const rowsByFile = new Map();
const notes = { notOwned: [], noToken: [], zero: [], documentConstant: [], combined: [], derived: [], undefinedToken: [], customRule: [] };
for (const row of map.migrations) {
  if (row.kind === 'derived-expression') { notes.derived.push(row); continue; }
  if (row.kind !== 'literal') continue;
  if (row.cls === 'exempt-zero') { notes.zero.push(row); continue; }
  if (row.cls === 'exempt-document-constant') { notes.documentConstant.push(row); continue; }
  if (!row.to) { notes.noToken.push(row); continue; }
  if (row.property === 'minWidth/minHeight') { notes.combined.push(row); continue; }
  if (!packageOf(row.file)) { notes.notOwned.push(row); continue; }
  if (!rowsByFile.has(row.file)) rowsByFile.set(row.file, []);
  rowsByFile.get(row.file).push({ ...row, done: 0 });
}

/** Extra rows for ForgeIcon's spring: the map lists it as one combined row. */
const spring = map.migrations.find(row => row.property === 'spring');
if (spring) {
  const list = rowsByFile.get(spring.file) ?? [];
  for (const [property, value] of [['stiffness', '260'], ['damping', '22'], ['mass', '0.8']]) {
    list.push({ file: spring.file, kind: 'literal', property, value, count: 1, to: `--spring-icon-${property}`, cls: spring.cls, done: 0, synthetic: true });
  }
  rowsByFile.set(spring.file, list.filter(row => row.property !== 'spring'));
}

const hexLike = /^#[0-9a-f]{3,8}$/i;
const isNumeric = node => Node.isNumericLiteral(node) || (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.MinusToken && Node.isNumericLiteral(node.getOperand()));
const numericOf = node => (Node.isNumericLiteral(node) ? Number(node.getText()) : -Number(node.getOperand().getText()));

/** The property assignment a literal is the value of, looking through ternary branches and parentheses. */
function owningProperty(node) {
  let current = node;
  for (;;) {
    const parent = current.getParent();
    if (!parent) return null;
    if (Node.isPropertyAssignment(parent)) return parent.getInitializer() === current ? parent : null;
    if (Node.isParenthesizedExpression(parent)) { current = parent; continue; }
    // `3 * k`: the literal is a factor, the token replaces just that factor.
    if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.AsteriskToken) { current = parent; continue; }
    if (Node.isConditionalExpression(parent) && parent.getCondition() !== current) { current = parent; continue; }
    return null;
  }
}
const propertyName = property => {
  const name = property.getNameNode();
  return Node.isStringLiteral(name) ? name.getLiteralText() : name.getText();
};

function tokenReference(pkg, tokenName, valueText, context) {
  if (pkg === 'packages/icons/src') {
    switch (tokenName) {
      case '--spacing-fixed-stack': return ICON_REFERENCES.hitSlop;
      case '--spacing-fixed-target': return ICON_REFERENCES.hitTarget;
      case '--opacity-disabled': return ICON_REFERENCES.opacityDisabled;
      case '--color-icon-surface': return valueText.toLowerCase() === '#11131b' ? ICON_REFERENCES.surfaceDark : valueText.toLowerCase() === '#ffffff' ? ICON_REFERENCES.surfaceLight : null;
      default: {
        const match = /^--spring-icon-(stiffness|damping|mass)$/.exec(tokenName);
        return match ? ICON_REFERENCES[match[1]] : null;
      }
    }
  }
  const entry = index.get(tokenName);
  if (!entry) return { error: `token ${tokenName} is not declared in tokens.ts` };
  const [group, key] = entry.path;
  const value = entry.value;
  if (typeof value === 'object') {
    const side = Object.entries(value).filter(([, v]) => v.toLowerCase() === String(valueText).toLowerCase()).map(([k]) => k);
    if (side.length !== 1) return { error: `${tokenName} has no unique dark/light side equal to ${valueText}` };
    return `tokens.${group}.${key}.${side[0]}`;
  }
  return `tokens.${group}.${key}`;
}

/** Hex rules need the token each site resolves to; a value shared by two roles in one file is split by the property it sits in. */
function pickToken(row, context) {
  const names = row.to.match(/--[a-z0-9-]+/g) ?? [];
  if (names.length === 1) return names[0];
  if (names.includes('--color-artboard-checker-a') && names.includes('--color-on-overlay-chip')) {
    return context.propertyName === 'color' ? '--color-on-overlay-chip' : '--color-artboard-checker-a';
  }
  return null;
}

const results = [];
const refusals = [];
for (const [file, rows] of rowsByFile) {
  const pkg = packageOf(file);
  if (TOKEN_FILES.has(file) || isTestFile(file)) continue;
  const original = readFileSync(join(repoRoot, file), 'utf8');
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const source = project.createSourceFile(file, original, { overwrite: true });
  const edits = [];
  const usedRoots = new Set();
  const numericRows = rows.filter(row => row.property !== 'colour' && row.property !== 'boxShadow');
  const colourRows = rows.filter(row => row.property === 'colour');
  const shadowRows = rows.filter(row => row.property === 'boxShadow' || (row.property === 'colour' && row.to?.startsWith('--shadow-')));
  const apply = (node, reference, row) => {
    const root = reference.split('.')[0];
    usedRoots.add(root);
    edits.push({ start: node.getStart(), end: node.getEnd(), text: reference });
    row.done += 1;
  };

  source.forEachDescendant(node => {
    // Numeric style literals, and fontWeight strings.
    if (isNumeric(node) && !(Node.isNumericLiteral(node) && Node.isPrefixUnaryExpression(node.getParent()))) {
      const property = owningProperty(node);
      if (!property) return;
      const name = propertyName(property);
      const value = numericOf(node);
      const row = numericRows.find(r => r.property === name && parseNumber(r.value) === value );
      if (!row) return;
      const reference = tokenReference(pkg, row.to, String(value), { propertyName: name });
      if (!reference || reference.error) { refusals.push({ file, row, why: reference?.error ?? 'no reference form' }); return; }
      const entry = pkg === 'packages/studio-workspace/src' ? index.get(row.to) : null;
      if (entry && typeof entry.value === 'number' && entry.value !== value) { refusals.push({ file, row, why: `value mismatch: token ${entry.value}, literal ${value}` }); return; }
      apply(node, reference, row);
      return;
    }
    if (Node.isStringLiteral(node)) {
      const text = node.getLiteralText();
      const property = owningProperty(node);
      if (property && propertyName(property) === 'fontWeight') {
        const row = numericRows.find(r => r.property === 'fontWeight' && r.value === text );
        if (row) {
          const entry = index.get(row.to);
          if (!entry || entry.value !== text) { refusals.push({ file, row, why: 'fontWeight token differs from the literal' }); return; }
          apply(node, `tokens.${entry.path.join('.')}`, row);
        }
        return;
      }
      if (hexLike.test(text)) {
        const candidates = colourRows.filter(r => r.value.toLowerCase() === text.toLowerCase() && !r.to.startsWith('--shadow-') );
        if (!candidates.length) return;
        const row = candidates[0];
        const parentProperty = node.getParent() && Node.isPropertyAssignment(node.getParent()) ? propertyName(node.getParent()) : null;
        const tokenName = pickToken(row, { propertyName: parentProperty });
        if (!tokenName) { refusals.push({ file, row, why: 'ambiguous token for this site' }); return; }
        const reference = tokenReference(pkg, tokenName, text, {});
        if (!reference || reference.error) { refusals.push({ file, row, why: reference?.error ?? 'no reference form' }); return; }
        const entry = pkg === 'packages/studio-workspace/src' ? index.get(tokenName) : null;
        if (entry) {
          const candidatesValue = typeof entry.value === 'object' ? Object.values(entry.value) : [entry.value];
          if (!candidatesValue.includes(text)) { refusals.push({ file, row, why: `case differs: token ${candidatesValue.join('/')} vs literal ${text}` }); return; }
        }
        apply(node, reference, row);
        row.doneTokens = [...(row.doneTokens ?? []), tokenName];
        return;
      }
      // Whole-string shadows: the string equals the token value.
      const shadow = shadowRows.find(r => {
        const entry = index.get(r.to);
        return entry && typeof entry.value === 'string' && entry.value === text;
      });
      if (shadow) apply(node, `tokens.${index.get(shadow.to).path.join('.')}`, shadow);
    }
  });

  // Splice edits from the end so earlier offsets stay valid.
  let text = original;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  if (edits.length) text = withImports(text, source, pkg, usedRoots);
  results.push({ file, rows, edits: edits.length, text, changed: text !== original });
  if (write && text !== original) writeFileSync(join(repoRoot, file), text);
}

function withImports(text, source, pkg, roots) {
  const info = PACKAGES[pkg];
  const names = [...roots].sort();
  const imports = source.getImportDeclarations();
  const existing = imports.find(decl => decl.getModuleSpecifierValue() === info.module);
  if (existing) {
    const have = new Set(existing.getNamedImports().map(spec => spec.getName()));
    const missing = names.filter(name => !have.has(name));
    if (!missing.length) return text;
    const named = existing.getNamedImports();
    const last = named[named.length - 1];
    const separator = info.style === 'js' ? ',' : ', ';
    return text.slice(0, last.getEnd()) + separator + missing.join(separator) + text.slice(last.getEnd());
  }
  const quote = info.style === 'js' ? '"' : "'";
  const spacing = info.style === 'js' ? '' : ' ';
  const line = `import {${spacing}${names.join(info.style === 'js' ? ',' : ', ')}${spacing}} from ${quote}${info.module}${quote};`;
  const last = imports[imports.length - 1];
  if (!last) return `${line}\n${text}`;
  return text.slice(0, last.getEnd()) + `\n${line}` + text.slice(last.getEnd());
}

// ---- report ----
let replaced = 0;
const short = [];
const extra = [];
const perFile = [];
for (const result of results) {
  let n = 0;
  for (const row of result.rows) {
    n += row.done;
    if (row.done < row.count) short.push(`${result.file} ${row.property}=${row.value} -> ${row.to}: replaced ${row.done} of ${row.count}`);
    if (row.done > row.count) extra.push(`${result.file} ${row.property}=${row.value} -> ${row.to}: replaced ${row.done}, map counted ${row.count}`);
  }
  replaced += n;
  perFile.push({ file: result.file, replaced: result.edits, changed: result.changed });
}
const expected = results.reduce((sum, r) => sum + r.rows.reduce((s, row) => s + row.count, 0), 0);
const uses = rows => rows.reduce((s, r) => s + (r.count ?? 1), 0);
const report = {
  mode: write ? 'write' : 'dry-run',
  filesWithRows: results.length,
  filesChanged: results.filter(r => r.changed).length,
  replaced,
  expectedByMap: expected,
  shortfalls: short,
  sitesBeyondMapCount: extra,
  refusals: refusals.map(r => `${r.file} ${r.row.property}=${r.row.value}: ${r.why}`),
  left: {
    exemptZero: uses(notes.zero),
    exemptDocumentConstant: uses(notes.documentConstant),
    notOwnedByThisCodemod: notes.notOwned.map(r => `${r.file} ${r.property}=${r.value} -> ${r.to}`),
    derivedExpressionRows: notes.derived.length,
    derivedExpressionUses: uses(notes.derived),
    derivedExpressions: notes.derived.map(r => `${r.file} ${r.expression} -> ${r.to} (${r.count})`),
    combinedRowsCoveredByOthers: notes.combined.map(r => `${r.file} ${r.property}`),
  },
  perFile,
};
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
