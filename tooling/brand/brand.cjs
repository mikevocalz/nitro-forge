'use strict';
// Brand manifests: one JSON file per installable app. The Expo config plugin
// (plugin.cjs), the rebrand test (rebrand-check.mjs) and the tests all read them
// through this module. Schema: brand.schema.json.

const fs = require('node:fs');
const path = require('node:path');

const BUNDLE_ID = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/;
const ANDROID_PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ICON_KEYS = ['app', 'adaptiveForeground', 'adaptiveBackground', 'adaptiveMonochrome', 'favicon'];
/** Fields a rebrand rewrites. `engine` and `icons` bind code and artwork, not the name. */
const NAME_FIELDS = ['id', 'productName', 'shortName', 'slug', 'scheme', 'ios.bundleIdentifier', 'android.package'];

function validate(brand, where = 'brand manifest') {
  const problems = [];
  const str = (key, value) => { if (typeof value !== 'string' || value.trim() === '') problems.push(`${key} must be a non-empty string`); };
  str('id', brand.id);
  str('productName', brand.productName);
  str('shortName', brand.shortName);
  if (brand.engine !== null && typeof brand.engine !== 'string') problems.push('engine must be a studio id or null');
  if (!SLUG.test(brand.slug ?? '')) problems.push(`slug "${brand.slug}" must be lower-case letters, digits and hyphens`);
  if (!SLUG.test(brand.scheme ?? '')) problems.push(`scheme "${brand.scheme}" must be lower-case letters, digits and hyphens`);
  if (!BUNDLE_ID.test(brand.ios?.bundleIdentifier ?? '')) problems.push(`ios.bundleIdentifier "${brand.ios?.bundleIdentifier}" is not a reverse-DNS identifier`);
  if (!ANDROID_PACKAGE.test(brand.android?.package ?? '')) problems.push(`android.package "${brand.android?.package}" is not a valid Java package name`);
  for (const key of ICON_KEYS) str(`icons.${key}`, brand.icons?.[key]);
  if (problems.length) throw new Error(`${where}: ${problems.join('; ')}`);
  return brand;
}

function load(file) {
  const brand = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(brand, file);
  const dir = path.dirname(path.resolve(file));
  const icons = Object.fromEntries(ICON_KEYS.map(key => [key, path.resolve(dir, brand.icons[key])]));
  return { ...brand, file: path.resolve(file), iconFiles: icons };
}

/**
 * Spellings a name takes across the manifest: "Nitro Forge" appears as
 * "Nitro Forge", "nitro-forge", "nitroforge", "nitro_forge" and "NITRO FORGE".
 */
function spellings(name) {
  const words = name.trim().split(/\s+/);
  const lower = words.map(w => w.toLowerCase());
  return {
    display: words.join(' '),
    kebab: lower.join('-'),
    compact: lower.join(''),
    snake: lower.join('_'),
    upper: words.join(' ').toUpperCase(),
    lowerSpaced: lower.join(' '),
  };
}

function getField(obj, dotted) { return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setField(obj, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
}

/** Replace one name with another in every name field, in every spelling. */
function rebrand(raw, from, to) {
  const a = spellings(from);
  const b = spellings(to);
  const next = structuredClone(raw);
  for (const field of NAME_FIELDS) {
    let value = getField(next, field);
    if (typeof value !== 'string') continue;
    // Longest spellings first so "Nitro Forge" is not half-replaced by "nitro".
    for (const key of ['display', 'upper', 'kebab', 'snake', 'lowerSpaced', 'compact']) {
      value = value.split(a[key]).join(b[key]);
    }
    setField(next, field, value);
  }
  return next;
}

/** Every case-insensitive spelling of `name` found in `text`, with context. */
function findName(text, name) {
  const s = spellings(name);
  const needles = [...new Set([s.lowerSpaced, s.kebab, s.compact, s.snake])];
  const hay = text.toLowerCase();
  const hits = [];
  for (const needle of needles) {
    let at = hay.indexOf(needle);
    while (at !== -1) {
      hits.push(text.slice(Math.max(0, at - 30), at + needle.length + 30).replace(/\s+/g, ' '));
      at = hay.indexOf(needle, at + 1);
    }
  }
  return hits;
}

/**
 * Source text with comments and module specifiers removed, so what remains is
 * code, string literals and JSX text. `@nitro-forge/...` imports and comments
 * that mention a name are not something a user sees.
 */
function visibleSource(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
    .replace(/\b(from|import|require)\s*\(?\s*(['"])[^'"\n]*\2/g, '$1 ""');
}

/**
 * Hardcoded copies of a display name in source: case-sensitive, whole words,
 * any run of whitespace between words ("Audio Lab" matches "Native Audio Lab"
 * but not "AudioLabScreen" or "audio-lab").
 */
function findDisplayName(src, name) {
  const words = name.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![A-Za-z0-9_])${words.join('\\s+')}(?![A-Za-z0-9_])`, 'g');
  const text = visibleSource(src);
  return [...text.matchAll(re)].map(m => text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' '));
}

module.exports = { load, validate, rebrand, spellings, findName, findDisplayName, visibleSource, NAME_FIELDS, ICON_KEYS };
