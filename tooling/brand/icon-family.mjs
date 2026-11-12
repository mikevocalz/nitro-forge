// Nitro Forge launcher icon family. Pure SVG source: every app icon, Android
// adaptive layer, monochrome layer and favicon is generated from this file.
// Spec: design/APP-IDENTITY.md, "Icon family". Renders: tooling/brand/render-icons.mjs.
//
// Grid: 1024 px canvas, 64 px unit (16 x 16 units), centre (512, 512).
// Every glyph point sits inside the 304 px keyline circle, which is inside the
// Android adaptive safe zone (66 of 108 dp = 313 px at 1024) and clears the
// iOS mask. Forms: one fill colour per studio plus one "steel" detail that
// every icon shares. Form weight is 64 px (1 unit), detail weight 48 px.

export const CANVAS = 1024;
export const UNIT = 64;
export const KEYLINE_RADIUS = 304;
export const STEEL = '#E6E8EC';

/** Grounds. Forged graphite for products, a lighter bench for labs. */
export const GROUNDS = Object.freeze({
  product: { top: '#1C1F25', bottom: '#121418' },
  lab: { top: '#2A2E36', bottom: '#1E2127' },
});

/**
 * Studio colours come from the forge: heat colours of glowing steel, the
 * temper colours steel takes as it cools, and copper patina.
 */
export const FAMILY = Object.freeze({
  suite: { colour: '#F3E7D3', source: 'white heat', ground: 'product', glyph: 'ingot' },
  prism: { colour: '#9C5FE6', source: 'temper purple', ground: 'product', glyph: 'prism' },
  quill: { colour: '#4F77E8', source: 'temper blue', ground: 'product', glyph: 'lines' },
  tally: { colour: '#33B38B', source: 'copper patina (verdigris)', ground: 'product', glyph: 'cells' },
  pitch: { colour: '#F07C2F', source: 'forge orange', ground: 'product', glyph: 'slide' },
  folio: { colour: '#DE4339', source: 'cherry red heat', ground: 'product', glyph: 'page' },
  splice: { colour: '#E3B23D', source: 'temper straw', ground: 'product', glyph: 'clips' },
  cadence: { colour: '#40B5DB', source: 'temper light blue', ground: 'product', glyph: 'wave' },
  'audio-lab': { colour: '#40B5DB', source: 'temper light blue (Cadence)', ground: 'lab', glyph: 'knob' },
  'media-lab': { colour: '#E3B23D', source: 'temper straw (Splice)', ground: 'lab', glyph: 'transport' },
  'cadence-qa': { colour: '#40B5DB', source: 'temper light blue (Cadence)', ground: 'lab', glyph: 'wave' },
});

const rect = (x, y, w, h, fill, r = 16) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const poly = (points, fill) => `<polygon points="${points.map(p => p.join(',')).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="16" stroke-linejoin="round"/>`;

/** Each glyph takes (fill, detail) and returns SVG elements on the 1024 grid. */
const GLYPHS = {
  // Suite: a forged ingot; a steel band marks the top face.
  ingot: (c, d) => poly([[280, 680], [344, 424], [680, 424], [744, 680]], c)
    + poly([[352, 344], [672, 344], [672, 392], [352, 392]], d),
  // Prism (image): a solid prism with one steel ray entering its face.
  prism: (c, d) => poly([[512, 280], [736, 668], [288, 668]], c)
    + rect(232, 496, 150, 48, d, 8),
  // Quill (rich text): three set lines and a steel caret.
  lines: (c, d) => rect(288, 368, 448, 64, c) + rect(288, 480, 448, 64, c) + rect(288, 592, 256, 64, c)
    + rect(584, 568, 48, 112, d, 8),
  // Tally (sheets): a 3 x 3 block of cells, one selected in steel.
  cells: (c, d) => {
    const at = [320, 459, 597];
    let out = '';
    at.forEach((y, row) => at.forEach((x, col) => { out += rect(x, y, 107, 107, row === 1 && col === 2 ? d : c, 12); }));
    return out;
  },
  // Pitch (slides): a slide on a steel stand.
  slide: (c, d) => rect(272, 336, 480, 272, c) + rect(488, 600, 48, 96, d, 0) + rect(400, 688, 224, 48, d, 8),
  // Folio (PDF): a page with its corner turned in steel.
  page: (c, d) => poly([[336, 304], [584, 304], [688, 408], [688, 720], [336, 720]], c)
    + poly([[584, 304], [584, 408], [688, 408]], d),
  // Splice (video): two clips overlapping on a timeline, a steel playhead.
  clips: (c, d) => rect(272, 400, 320, 96, c) + rect(432, 528, 320, 96, c)
    + rect(488, 344, 48, 336, d, 8) + rect(464, 320, 96, 56, d, 12),
  // Cadence (audio): a level meter, the peak bar in steel.
  wave: (c, d) => [[272, 160], [376, 320], [480, 448], [584, 272], [688, 192]]
    .map(([x, h], i) => rect(x, 512 - h / 2, 64, h, i === 2 ? d : c, 32)).join(''),
  // Audio Lab: a rotary knob with a steel pointer.
  knob: (c, d) => `<circle cx="512" cy="512" r="192" fill="${c}"/>`
    + `<rect x="488" y="352" width="48" height="176" rx="24" fill="${d}" transform="rotate(-40 512 512)"/>`,
  // Media Lab: a transport play control with a steel cue bar.
  transport: (c, d) => poly([[440, 320], [440, 704], [728, 512]], c) + rect(296, 320, 64, 384, d, 8),
};

const gradient = (id, g) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g.top}"/><stop offset="1" stop-color="${g.bottom}"/></linearGradient></defs>`;

/** Bench hatching along the lower edge marks a lab build. */
const hatch = () => {
  let out = '';
  for (let x = -224; x < CANVAS; x += 64) out += `<polygon points="${x},1024 ${x + 32},1024 ${x + 240},816 ${x + 208},816" fill="${STEEL}" fill-opacity="0.16"/>`;
  return `<g>${out}</g>`;
};

const svg = (body, size = CANVAS) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">${body}</svg>\n`;

function ground(id, radius = 0) {
  const f = FAMILY[id];
  const g = GROUNDS[f.ground];
  return gradient('g', g) + `<rect width="${CANVAS}" height="${CANVAS}" rx="${radius}" fill="url(#g)"/>` + (f.ground === 'lab' ? hatch() : '');
}

/**
 * Android shows about 72 of the 108 dp adaptive layer, so a glyph drawn to the
 * keyline fills about two thirds of the visible tile. A full-bleed icon shows
 * the whole canvas, so the glyph is scaled by SQUARE_SCALE to fill the same share.
 */
export const SQUARE_SCALE = 1.3;

function glyph(id, mono = false, scale = 1) {
  const f = FAMILY[id];
  if (!f) throw new Error(`No icon family entry for "${id}"`);
  const body = GLYPHS[f.glyph](mono ? '#FFFFFF' : f.colour, mono ? '#FFFFFF' : STEEL);
  if (scale === 1) return body;
  const shift = (CANVAS / 2) * (1 - scale);
  return `<g transform="translate(${shift} ${shift}) scale(${scale})">${body}</g>`;
}

/** Full-bleed square icon, no transparency (iOS, store listings, desktop). */
export const appIcon = id => svg(ground(id) + glyph(id, false, SQUARE_SCALE));
/** Android adaptive background layer. */
export const adaptiveBackground = id => svg(ground(id));
/** Android adaptive foreground layer: glyph only, inside the safe zone. */
export const adaptiveForeground = id => svg(glyph(id));
/** Android 13+ themed icon layer: one colour, the system tints it. */
export const adaptiveMonochrome = id => svg(glyph(id, true));
/** Web favicon: the browser applies no mask, so the ground carries its own corner. */
export const favicon = id => svg(ground(id, 184) + glyph(id, false, SQUARE_SCALE));

export const FAMILY_IDS = Object.freeze(Object.keys(FAMILY));
