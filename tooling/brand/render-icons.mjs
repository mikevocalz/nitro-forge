#!/usr/bin/env node
// Renders the launcher icon family (icon-family.mjs) to PNG:
//   - each app's icon set, at the paths its brand manifest names
//   - studio-preview's web icons and favicon
//   - test renders at 16, 32, 60 and 1024 px under design/icons/renders/
//
// The rasteriser (@resvg/resvg-js) is not a workspace dependency. Pass
// RESVG_DIR=<dir with node_modules/@resvg/resvg-js>, or the script installs
// the pinned version into a temporary folder first.
//
//   node tooling/brand/render-icons.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as family from './icon-family.mjs';

const RESVG_VERSION = '2.6.2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const brandLib = createRequire(import.meta.url)('./brand.cjs');

function resvg() {
  let dir = process.env.RESVG_DIR;
  if (!dir) {
    dir = join(tmpdir(), `forge-resvg-${RESVG_VERSION}`);
    if (!existsSync(join(dir, 'node_modules/@resvg/resvg-js'))) {
      mkdirSync(dir, { recursive: true });
      execFileSync('npm', ['install', '--no-save', '--prefix', dir, `@resvg/resvg-js@${RESVG_VERSION}`], { stdio: 'inherit' });
    }
  }
  return createRequire(join(dir, 'noop.js'))('@resvg/resvg-js').Resvg;
}
const Resvg = resvg();

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng();
function write(file, data) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); }

export function manifests() {
  const files = [
    ...readdirSync(join(root, 'apps/example/brands')).filter(f => f.endsWith('.json')).map(f => join(root, 'apps/example/brands', f)),
    join(root, 'apps/forge-audio-lab/brand.json'),
    join(root, 'apps/forge-media-lab/brand.json'),
    join(root, 'examples/native-cadence/brand.json'),
  ];
  return files.map(f => brandLib.load(f));
}

// 1. App icon sets, at the paths each manifest names.
for (const brand of manifests()) {
  const id = brand.icons.family;
  const out = brand.iconFiles;
  write(out.app, png(family.appIcon(id), 1024));
  write(out.adaptiveForeground, png(family.adaptiveForeground(id), 1024));
  write(out.adaptiveBackground, png(family.adaptiveBackground(id), 1024));
  write(out.adaptiveMonochrome, png(family.adaptiveMonochrome(id), 1024));
  write(out.favicon, png(family.favicon(id), 256));
}

// 2. studio-preview (Vite web): SVG favicon, touch icon, manifest icons.
const pub = join(root, 'apps/studio-preview/public');
write(join(pub, 'favicon.svg'), family.favicon('suite'));
write(join(pub, 'apple-touch-icon.png'), png(family.appIcon('suite'), 180));
write(join(pub, 'icon-192.png'), png(family.favicon('suite'), 192));
write(join(pub, 'icon-512.png'), png(family.favicon('suite'), 512));

// 3. Test renders. Each size is rasterised from the vector at that size, as a
// launcher or browser does; the mask is the rounded square the OS applies.
const SIZES = [16, 32, 60, 1024];
const RENDERS = join(root, 'design/icons/renders');
const inner = (svg, n) => svg.replace(/<svg[^>]*>/, '').replace('</svg>', '').replaceAll('id="g"', `id="g${n}"`).replaceAll('url(#g)', `url(#g${n})`);
const masked = (id, n) => `<clipPath id="m${n}"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#m${n})">${inner(family.appIcon(id), n)}</g>`;

for (const id of family.FAMILY_IDS) {
  for (const size of SIZES) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${masked(id, 0)}</svg>`;
    write(join(RENDERS, id, `${id}-${size}.png`), png(svg, size));
  }
}

// Family strips at each test size, on a dark and a light wallpaper, drawn 1:1.
const SUITE = ['suite', 'prism', 'quill', 'tally', 'pitch', 'folio', 'splice', 'cadence'];
for (const size of [16, 32, 60]) {
  const gap = Math.max(6, size / 3);
  const w = SUITE.length * (size + gap) + gap;
  const h = (size + gap) * 2 + gap;
  let body = '';
  ['#D9DDE3', '#20242B'].forEach((wall, row) => {
    body += `<rect y="${row * (size + gap)}" width="${w}" height="${size + 2 * gap}" fill="${wall}"/>`;
    SUITE.forEach((id, i) => {
      body += `<g transform="translate(${gap + i * (size + gap)},${gap + row * (size + gap)}) scale(${size / 1024})">${masked(id, row * 10 + i)}</g>`;
    });
  });
  write(join(RENDERS, `family-${size}.png`), png(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`, w));
}

// Home-screen mock: the suite at iPad icon size (76 pt drawn at 2x), with the
// short launcher labels from the manifests, on a dark and a light wallpaper.
const labels = Object.fromEntries(manifests().map(b => [b.icons.family, b.shortName]));
{
  const icon = 152, colW = 220, rowH = 236, pad = 48;
  const w = pad * 2 + colW * 4, h = pad * 2 + rowH * 2;
  const sheet = (wall, ink) => {
    let body = `<rect width="${w}" height="${h}" fill="${wall}"/>`;
    SUITE.forEach((id, i) => {
      const x = pad + (i % 4) * colW + (colW - icon) / 2;
      const y = pad + Math.floor(i / 4) * rowH;
      body += `<g transform="translate(${x},${y}) scale(${icon / 1024})">${masked(id, i)}</g>`;
      body += `<text x="${x + icon / 2}" y="${y + icon + 34}" fill="${ink}" font-family="Helvetica Neue, Helvetica, Arial" font-size="24" text-anchor="middle">${labels[id]}</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
  };
  write(join(RENDERS, 'home-screen-dark.png'), png(sheet('#1A2433', '#FFFFFF'), w));
  write(join(RENDERS, 'home-screen-light.png'), png(sheet('#C9D3DF', '#11151B'), w));
}

console.log('Rendered icon sets, web icons and test renders.');
