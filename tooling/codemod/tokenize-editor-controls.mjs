#!/usr/bin/env node
// Tokenization codemod for packages/editor-controls/src (2026-11-28).
//
// Rewrites each literal check-no-hardcoded.mjs reports in editor-controls (kinds
// number and prop) into a reference to packages/editor-controls/src/tokens.ts.
// The vocabulary is read from that module at run time, so a reference always
// resolves to the value this script chose.
//
// Rules, in order:
//   1. A literal equal to a token of its role becomes that token (identical value).
//      Roles come from the property: spacing (position, padding, margin, gap, size),
//      type (fontSize), leading (lineHeight), border (border and outline widths),
//      weight (fontWeight), layer (zIndex), opacity, icon (the JSX `size` prop).
//   2. A literal with no token of its role is snapped to the nearest token of that
//      role and reported as a snap (file:line, old -> new) for owner review.
//      Ties go to the workspace's named steps before the off-scale steps, then to
//      the smaller value.
//   3. A half-pixel offset (0.5) is `tokens.borderWidth.hairline / 2`: the same value,
//      written as what it is (half a hairline, to centre a 1 px line). An off-step
//      position or margin that is exactly half a step (9 to centre an 18 px puck)
//      is `<step> / 2` rather than a snap.
//   A border wider than the border scale draws a shape (a CSS triangle, a knob
//   ring) and is sized from the spacing scale. A literal that multiplies a
//   computed size by a fraction (`size * 0.3`) is glyph geometry and is left, as
//   are the sites in SKIP_SITES; both are in allowlist.json with a reason.
//   4. A circle's radius in a `radius-exempt` call site becomes `<diameter token> / 2`.
//   5. Opacity: a decorative mark (listed in DECORATIVE_OPACITY) takes
//      controlTokens.opacity; every other opacity below 1 is a disabled or
//      unavailable state and takes tokens.opacity.disabled.
// Anything else (colours, Tailwind arbitrary values, data the gate misreads) is
// left for a hand fix and listed under `manual`.
//
//   node tooling/codemod/tokenize-editor-controls.mjs            dry run: prints the summary
//   node tooling/codemod/tokenize-editor-controls.mjs --write    rewrites files in place
//   node tooling/codemod/tokenize-editor-controls.mjs --json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSX_NUMERIC_PROPS, STYLE_PROPS, isTestFile, listSources, loadTsMorph, numericPartsOf, repoRoot } from './lib.mjs';

const { Project, SyntaxKind, Node } = loadTsMorph();
const numericParts = numericPartsOf({ Node, SyntaxKind });
const args = process.argv.slice(2);
const write = args.includes('--write');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const PACKAGE_SRC = 'packages/editor-controls/src';
const TOKEN_MODULE = `${PACKAGE_SRC}/tokens.ts`;
const { tokens, controlTokens } = await import(pathToFileURL(join(repoRoot, TOKEN_MODULE)).href);

/** Opacity of decorative marks, by file:line. Every other opacity is a disabled state. */
export const DECORATIVE_OPACITY = {
  'canvas/SnapGridOverlay.tsx:43': 'grid lines (major strong, minor faint)',
  'canvas/SnapGridOverlay.tsx:45': 'grid lines (major strong, minor faint)',
  'audio/EQFrequencyGraph.tsx:190': 'minor frequency grid line',
  'audio/EQFrequencyGraph.tsx:193': 'major level grid line',
  'audio/AutomationLane.tsx:206': 'bar line against beat lines',
  'audio/DynamicsTransferGraph.tsx:227': 'unity reference line',
  'canvas/CanvasRuler.tsx:280': 'guide being removed / resting guide',
  'graphics/ImageCropOverlay.tsx:79': 'crop shade',
  'inputs/InstrumentXYPad.tsx:104': 'centre crosshair',
  'inputs/InstrumentXYPad.tsx:106': 'centre crosshair',
  'layers/LayerThumbnail.tsx:125': 'transparency checker cell',
  'layers/LayerThumbnail.tsx:133': 'placeholder bar',
  'layers/LayerThumbnail.tsx:134': 'placeholder bar',
  'timeline/SafeAreaOverlay.tsx:58': 'outside-safe-area matte',
  'timeline/SafeAreaOverlay.tsx:69': 'rule-of-thirds line',
  'timeline/SafeAreaOverlay.tsx:70': 'rule-of-thirds line',
  'timeline/TimelinePlayhead.tsx:86': 'playhead handle while the playhead is out of view',
  'pdf/CommentsThreadPanel.tsx:105': 'resolved thread',
  'timeline/TransitionPresetBrowser.tsx:68': 'overlapping second tile',
  'layers/ArtboardNavigator.tsx:243': 'artboard being dragged',
  'canvas-tools/ReferenceImageBoard.tsx:266': 'pin corner while pinned',
};

/** Sites left as they are: data the gate reads as style, or geometry ratios. Each has an allowlist entry. */
export const SKIP_SITES = {
  'photo/photo-export.ts:8': 'default export settings (watermark opacity and size are document data, not a style)',
  'slides/slide-model.ts:41': 'default slide size of the document model (960 x 540), not a style',
  'color/SVColorField.tsx:36': 'centre of gradient step i of 48 (i + 0.5), arithmetic, not an opacity value',
  'color/SVColorField.tsx:37': 'centre of gradient step i of 48 (i + 0.5), arithmetic, not an opacity value',
};
/** Sites whose role is not what the property says. */
export const OVERRIDES = {
  'audio/PluginPresetBrowser.tsx:127 fontSize 16': 'controlTokens.type.input',
  'slides/SlideThumbnail.tsx:49 lineHeight 1.2': 'controlTokens.leadingRatio.thumbnail',
};

// ---- vocabularies: [value, reference, tier] (lower tier wins a tie) ----
const ref = (root, group, key) => ({ value: root === 'tokens' ? tokens[group][key] : controlTokens[group][key], text: `${root}.${group}.${key}` });
const entries = (root, group, tier, keys) => (keys ?? Object.keys((root === 'tokens' ? tokens : controlTokens)[group])).map(key => ({ ...ref(root, group, key), tier }));
const spacingKeys = Object.keys(tokens.spacing);
const fixedSpace = spacingKeys.filter(key => ['fixedStack', 'fixedElement', 'fixedInset', 'fixedGroup', 'fixedSection', 'fixedCanvas', 'fixedPage'].includes(key));
const fixedSize = spacingKeys.filter(key => key.startsWith('fixed') && !fixedSpace.includes(key));
const offSpace = spacingKeys.filter(key => key.startsWith('off'));
const VOCAB = {
  spacing: [
    ...entries('tokens', 'spacing', 0, fixedSpace),
    ...entries('tokens', 'spacing', 1, fixedSize),
    ...entries('tokens', 'spacing', 2, offSpace),
    ...entries('controlTokens', 'extent', 3),
    { ...ref('tokens', 'borderWidth', 'hairline'), tier: 4 },
  ],
  icon: [...entries('tokens', 'size', 0), ...entries('tokens', 'spacing', 1, fixedSpace), ...entries('tokens', 'spacing', 2, offSpace)],
  type: [...entries('tokens', 'text', 0, ['micro', 'label', 'body', 'title', 'display']), ...entries('tokens', 'text', 1, Object.keys(tokens.text).filter(key => key.startsWith('off')))],
  leading: [...entries('tokens', 'leading', 1), ...entries('tokens', 'text', 0, ['micro', 'label', 'body', 'title', 'display']), ...entries('tokens', 'text', 1, Object.keys(tokens.text).filter(key => key.startsWith('off')))],
  border: entries('tokens', 'borderWidth', 0),
  weight: entries('tokens', 'fontWeight', 0).map(entry => ({ ...entry, value: Number(entry.value) })),
  layer: entries('controlTokens', 'layer', 0),
};
const ROLE_OF = property => {
  if (property === 'fontSize') return 'type';
  if (property === 'lineHeight') return 'leading';
  if (/^border\w*Width$|^outlineWidth$/.test(property)) return 'border';
  if (property === 'fontWeight') return 'weight';
  if (property === 'zIndex') return 'layer';
  if (property === 'opacity') return 'opacity';
  if (/Radius$/.test(property)) return 'radius';
  if (['letterSpacing', 'shadowRadius', 'shadowOpacity', 'elevation'].includes(property)) return null;
  return 'spacing';
};

/** Nearest vocabulary entry; exact when `distance` is 0. */
function nearest(role, value) {
  const list = VOCAB[role];
  let best = null;
  for (const entry of list) {
    const distance = Math.abs(entry.value - value);
    if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) < 1e-9 && (entry.tier < best.entry.tier || (entry.tier === best.entry.tier && entry.value < best.entry.value)))) best = { entry, distance };
  }
  return best;
}

const report = { files: 0, rewritten: 0, exact: 0, snapped: [], manual: [], skipped: [], byRole: {} };
const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, jsx: 1 } });
const files = listSources([PACKAGE_SRC], /\.(tsx?|jsx?)$/).filter(file => !isTestFile(file) && file !== TOKEN_MODULE && !/\/(tokens|theme|radius)\.(ts|js)$/.test(file));

const short = file => file.slice(PACKAGE_SRC.length + 1);
const lineText = (source, line) => source.getFullText().split('\n')[line - 1] ?? '';
const markerNear = (source, line) => /radius-exempt:/.test(lineText(source, line)) || /radius-exempt:/.test(lineText(source, line - 1));

for (const file of files) {
  const text = readFileSync(join(repoRoot, file), 'utf8');
  const source = project.createSourceFile(file, text, { overwrite: true });
  const edits = [];
  const used = new Set();
  const plan = (node, property, kind) => {
    const { line } = source.getLineAndColumnAtPos(node.getStart());
    const raw = node.getText();
    const value = Number(raw);
    const where = `${short(file)}:${line}`;
    const negative = Node.isPrefixUnaryExpression(node.getParent()) && node.getParent().getOperatorToken() === SyntaxKind.MinusToken;
    const role = kind === 'prop' ? (property === 'size' ? 'icon' : property === 'fontSize' ? 'type' : property === 'strokeWidth' ? 'border' : 'spacing') : ROLE_OF(property);
    const fail = reason => report.manual.push({ where, property, value: raw, reason });
    if (SKIP_SITES[where]) return report.skipped.push({ where, property, value: raw, reason: SKIP_SITES[where] });
    const override = OVERRIDES[`${where} ${property} ${raw}`];
    if (override) {
      used.add(override.split('.')[0]);
      report.byRole.override = (report.byRole.override ?? 0) + 1;
      report.exact += 1;
      edits.push({ node, replacement: override });
      return;
    }
    const parent = node.getParent();
    const factor = Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.AsteriskToken && Math.abs(value) < 1;
    if (factor) return report.skipped.push({ where, property, value: raw, reason: 'proportion of a computed size (size * k), glyph geometry' });
    if (!role) return fail('no role for this property');
    let replacement;
    let snapped = null;
    if (role === 'opacity') {
      const decorative = DECORATIVE_OPACITY[where];
      if (decorative) {
        const best = [...Object.entries(controlTokens.opacity)].map(([key, v]) => ({ key, v, d: Math.abs(v - value) })).sort((a, b) => a.d - b.d || a.v - b.v)[0];
        replacement = `controlTokens.opacity.${best.key}`;
        if (best.d > 1e-9) snapped = { to: best.v, why: decorative };
      } else {
        replacement = 'tokens.opacity.disabled';
        if (Math.abs(value - tokens.opacity.disabled) > 1e-9) snapped = { to: tokens.opacity.disabled, why: 'disabled or unavailable state' };
      }
    } else if (role === 'radius') {
      if (!markerNear(source, line)) return fail('radius literal without a radius-exempt marker');
      const best = nearest('spacing', value * 2);
      replacement = `${best.entry.text} / 2`;
      if (best.distance > 1e-9) snapped = { to: best.entry.value / 2, why: 'circle radius from the nearest diameter step' };
      if (best.entry.text.startsWith('controlTokens')) used.add('controlTokens'); else used.add('tokens');
    } else if (role === 'spacing' && Math.abs(value) === 0.5) {
      replacement = 'tokens.borderWidth.hairline / 2';
    } else {
      // A border wider than the border scale draws a shape (a CSS triangle, a knob ring): it is sized like spacing.
      const scale = role === 'border' && Math.abs(value) > tokens.borderWidth.off3 ? 'spacing' : role;
      const best = nearest(scale, Math.abs(value));
      const half = scale === 'spacing' && /^(left|right|top|bottom|margin\w*)$/.test(property) && best.distance > 1e-9 ? VOCAB.spacing.find(entry => entry.tier <= 2 && Math.abs(entry.value - Math.abs(value) * 2) < 1e-9) : null;
      if (half) replacement = `${half.text} / 2`;
      else {
        replacement = best.entry.text;
        if (best.distance > 1e-9) snapped = { to: best.entry.value, why: `nearest ${scale} step` };
      }
    }
    if (replacement.includes('/ 2') && (Node.isBinaryExpression(node.getParent()) || negative)) replacement = `(${replacement})`;
    used.add(replacement.startsWith('controlTokens') ? 'controlTokens' : 'tokens');
    report.byRole[role] = (report.byRole[role] ?? 0) + 1;
    if (snapped) report.snapped.push({ where, property, from: `${negative ? '-' : ''}${raw}`, to: `${negative ? '-' : ''}${snapped.to}`, token: replacement, why: snapped.why });
    else report.exact += 1;
    edits.push({ node, replacement });
  };
  source.forEachDescendant(node => {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.getParent();
      if (Node.isPropertyAssignment(parent) && parent.getInitializer() === node) {
        const nameNode = parent.getNameNode();
        const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : parent.getName();
        if (name === 'fontWeight' && /^\d+$/.test(node.getLiteralText())) {
          const value = Number(node.getLiteralText());
          const best = nearest('weight', value);
          const { line } = source.getLineAndColumnAtPos(node.getStart());
          if (best.distance > 0) report.snapped.push({ where: `${short(file)}:${line}`, property: name, from: node.getLiteralText(), to: String(best.entry.value), token: best.entry.text, why: 'nearest weight' });
          else report.exact += 1;
          report.byRole.weight = (report.byRole.weight ?? 0) + 1;
          used.add('tokens');
          edits.push({ node, replacement: best.entry.text });
        }
      }
    } else if (Node.isJsxAttribute(node)) {
      const name = node.getNameNode().getText();
      if (!JSX_NUMERIC_PROPS.has(name)) return;
      const initializer = node.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer) || !initializer.getExpression()) return;
      for (const part of numericParts(initializer.getExpression())) if (Number(part.getText()) !== 0) plan(part, name, 'prop');
    } else if (Node.isPropertyAssignment(node)) {
      const nameNode = node.getNameNode();
      const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : node.getName();
      if (!STYLE_PROPS.has(name)) return;
      const initializer = node.getInitializer();
      if (!initializer) return;
      for (const part of numericParts(initializer)) {
        const value = Number(part.getText());
        if (value === 0 || (name === 'opacity' && value === 1)) continue;
        plan(part, name, 'number');
      }
    }
  });
  if (!edits.length) continue;
  report.files += 1;
  report.rewritten += edits.length;
  if (!write) continue;
  // Replace from the end so earlier positions stay valid.
  let out = text;
  for (const { node, replacement } of edits.sort((a, b) => b.node.getStart() - a.node.getStart())) {
    out = out.slice(0, node.getStart()) + replacement + out.slice(node.getEnd());
  }
  out = addImport(out, file, [...used].sort());
  writeFileSync(join(repoRoot, file), out);
}

/** Adds `import { tokens, controlTokens } from "<rel>/tokens.ts"` after the last import, in the file's quote style. */
function addImport(text, file, names) {
  let rel = relative(dirname(file), TOKEN_MODULE).replaceAll('\\', '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  const quote = /from\s+'/.test(text) && !/from\s+"/.test(text) ? "'" : '"';
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"];?`);
  const match = text.match(existing);
  if (match) {
    const have = match[1].split(',').map(name => name.trim()).filter(Boolean);
    const all = [...new Set([...have, ...names])].sort();
    return text.replace(existing, `import { ${all.join(', ')} } from ${quote}${rel}${quote};`);
  }
  const line = `import { ${names.join(', ')} } from ${quote}${rel}${quote};`;
  const imports = [...text.matchAll(/^import[\s\S]*?from\s*['"][^'"]+['"];?[^\n]*$/gm)];
  if (!imports.length) {
    // After a leading comment block, if any.
    const header = text.match(/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\n)*/)[0];
    return `${text.slice(0, header.length)}${line}\n${text.slice(header.length)}`;
  }
  const last = imports[imports.length - 1];
  const end = last.index + last[0].length;
  return `${text.slice(0, end)}\n${line}${text.slice(end)}`;
}

const summary = { files: report.files, rewritten: report.rewritten, exact: report.exact, snapped: report.snapped.length, manual: report.manual.length, skipped: report.skipped.length, byRole: report.byRole };
console.log(JSON.stringify(summary, null, 2));
for (const item of report.manual) console.log(`MANUAL ${item.where} ${item.property}=${item.value} (${item.reason})`);
for (const item of report.skipped) console.log(`SKIP   ${item.where} ${item.property}=${item.value} (${item.reason})`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
