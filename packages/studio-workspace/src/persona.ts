/** Design studio personas: Vector, Pixel, Layout and Sketch views over one
 * Prism document session. A persona is data ({@linkcode PersonaSpec}), never
 * document state: layers, edits and undo stay in the Rust engine behind
 * `ForgeDocument`, so undo from any persona reverts the last engine change.
 * Continuity (selection, viewport, color, brush) belongs to the open document
 * and is carried unchanged across every switch.
 */
import { forgeInstrumentBlueprints } from './instrument-system.ts';

/** A device class the persona switcher renders on. */
export type PersonaSurface = 'iphone' | 'ipad' | 'android-phone' | 'android-foldable' | 'web' | 'desktop' | 'xr';
/** Every surface, in manifest order. */
export const PERSONA_SURFACES: readonly PersonaSurface[] = ['iphone', 'ipad', 'android-phone', 'android-foldable', 'web', 'desktop', 'xr'];

/** Whether the Prism engine implements a capability in this build. */
export type EngineSupport = 'available' | 'not-in-engine';

/** One feature a persona offers, with honest engine and surface support. */
export type PersonaCapability = Readonly<{
  id: string;
  label: string;
  /** Engine ops backing it (docs/ENGINE_OPS.md), empty when not implemented. */
  ops: readonly string[];
  engine: EngineSupport;
  surfaces: readonly PersonaSurface[] | 'all';
}>;

/** Capability catalog. `available` entries map to real prism-engine ops. */
export const personaCapabilities: readonly PersonaCapability[] = [
  { id: 'shapes', label: 'Rectangles and ellipses', ops: ['addShape', 'setShapeFill', 'transformShape'], engine: 'available', surfaces: 'all' },
  { id: 'path-nodes', label: 'Paths and nodes', ops: [], engine: 'not-in-engine', surfaces: 'all' },
  { id: 'boolean-ops', label: 'Boolean operations', ops: [], engine: 'not-in-engine', surfaces: 'all' },
  { id: 'raster-layers', label: 'Pixel layers', ops: ['addRasterLayer', 'drawPixels', 'fillLayer'], engine: 'available', surfaces: 'all' },
  { id: 'filters', label: 'Filters', ops: ['applyFilter'], engine: 'available', surfaces: 'all' },
  { id: 'layer-stack', label: 'Layer order, opacity and visibility', ops: ['moveLayer', 'setLayerOpacity', 'setLayerVisible', 'renameLayer', 'removeLayer'], engine: 'available', surfaces: 'all' },
  { id: 'pages', label: 'Pages', ops: [], engine: 'not-in-engine', surfaces: 'all' },
  { id: 'text-frames', label: 'Text frames', ops: [], engine: 'not-in-engine', surfaces: 'all' },
  { id: 'guides', label: 'Guides', ops: [], engine: 'not-in-engine', surfaces: 'all' },
  { id: 'data-merge', label: 'Data merge', ops: [], engine: 'not-in-engine', surfaces: ['desktop', 'web'] },
  { id: 'pencil-strokes', label: 'Pencil strokes as editable paths', ops: [], engine: 'not-in-engine', surfaces: ['ipad', 'xr'] },
];

const CAPABILITY_BY_ID = new Map(personaCapabilities.map(c => [c.id, c]));
const INSTRUMENT_IDS: ReadonlySet<string> = new Set(forgeInstrumentBlueprints.map(i => i.id));

/** A persona: an instrument rail and capability set over the shared document. */
export type PersonaSpec = Readonly<{
  id: string;
  label: string;
  /** Instrument ids from `forgeInstrumentBlueprints`, in rail order. */
  rail: readonly string[];
  /** Capability ids from {@linkcode personaCapabilities}. */
  capabilities: readonly string[];
  /** Surfaces this persona appears on; omitted surfaces show the reason. */
  surfaces: readonly PersonaSurface[] | 'all';
  builtIn: boolean;
}>;

/** The four pre-built personas. Sketch is declared iPad and XR only. */
export const BUILT_IN_PERSONAS: readonly PersonaSpec[] = [
  { id: 'vector', label: 'Vector', rail: ['forge.precision-scrubber', 'forge.chroma-space', 'forge.layer-constellation'], capabilities: ['shapes', 'path-nodes', 'boolean-ops', 'layer-stack'], surfaces: 'all', builtIn: true },
  { id: 'pixel', label: 'Pixel', rail: ['forge.ink-deck', 'forge.chroma-space', 'forge.layer-constellation'], capabilities: ['raster-layers', 'filters', 'layer-stack'], surfaces: 'all', builtIn: true },
  { id: 'layout', label: 'Layout', rail: ['forge.precision-scrubber', 'forge.layer-constellation'], capabilities: ['pages', 'text-frames', 'guides', 'data-merge', 'layer-stack'], surfaces: 'all', builtIn: true },
  { id: 'sketch', label: 'Sketch', rail: ['forge.ink-deck', 'forge.chroma-space'], capabilities: ['pencil-strokes', 'raster-layers'], surfaces: ['ipad', 'xr'], builtIn: true },
];

/** Workspace state that survives every persona switch. Document edits and
 * undo are not here: the engine owns them. */
export type ContinuityState = Readonly<{
  selectedLayerId: number | undefined;
  viewport: Readonly<{ zoom: number; panX: number; panY: number }>;
  /** RGBA, 0..255 per channel; the Chroma Space value and the fill swatch. */
  color: readonly [number, number, number, number];
  /** Ink Deck brush diameter in document pixels; the Pixel stroke width. */
  brushSizePx: number;
}>;

/** The active persona plus the continuity it carries. */
export type PersonaSession = Readonly<{ personaId: string; continuity: ContinuityState }>;

const SURFACE_WORDS: Record<PersonaSurface, string> = {
  iphone: 'iPhone', ipad: 'iPad', 'android-phone': 'Android phones', 'android-foldable': 'Android foldables',
  web: 'web', desktop: 'desktop', xr: 'XR',
};

function onSurface(surfaces: readonly PersonaSurface[] | 'all', surface: PersonaSurface) {
  return surfaces === 'all' || surfaces.includes(surface);
}

function surfaceList(surfaces: readonly PersonaSurface[]) {
  const words = surfaces.map(s => SURFACE_WORDS[s]);
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** One manifest line as the turret readout shows it. */
export type ManifestLine = Readonly<{ id: string; label: string; ready: boolean; note: string | undefined }>;

/** What a persona offers on a surface, with a plain-words reason for every
 * missing item. `available` is false when the persona itself is not on it. */
export type PersonaManifest = Readonly<{ available: boolean; reason: string | undefined; lines: readonly ManifestLine[] }>;

/** Build the capability manifest the switcher renders for `persona` on `surface`. */
export function personaManifest(persona: PersonaSpec, surface: PersonaSurface): PersonaManifest {
  const available = onSurface(persona.surfaces, surface);
  const reason = available || persona.surfaces === 'all' ? undefined : `${persona.label}: ${surfaceList(persona.surfaces)} only`;
  const lines = persona.capabilities.map(id => {
    const c = CAPABILITY_BY_ID.get(id);
    if (!c) throw new Error(`Persona '${persona.id}' names unknown capability '${id}'`);
    if (c.surfaces !== 'all' && !c.surfaces.includes(surface)) return { id, label: c.label, ready: false, note: `${c.label}: ${surfaceList(c.surfaces)} only` };
    if (c.engine === 'not-in-engine') return { id, label: c.label, ready: false, note: `${c.label}: not in this build` };
    return { id, label: c.label, ready: true, note: undefined };
  });
  return { available, reason, lines };
}

/** Personas the turret shows as stops on `surface`, in order. */
export function personasOn(personas: readonly PersonaSpec[], surface: PersonaSurface): PersonaSpec[] {
  return personas.filter(p => onSurface(p.surfaces, surface));
}

/** Switch persona. Continuity is returned by reference, unchanged.
 * @throws when `toId` is unknown or not on `surface`, naming the reason. */
export function switchPersona(session: PersonaSession, toId: string, personas: readonly PersonaSpec[], surface: PersonaSurface): PersonaSession {
  const to = personas.find(p => p.id === toId);
  if (!to) throw new Error(`Unknown persona '${toId}'`);
  const manifest = personaManifest(to, surface);
  if (!manifest.available) throw new Error(manifest.reason);
  if (to.id === session.personaId) return session;
  return { personaId: to.id, continuity: session.continuity };
}

/** A user draft for the Persona Composer. */
export type PersonaDraft = Readonly<{ label: string; rail: readonly string[]; capabilities: readonly string[]; surfaces?: readonly PersonaSurface[] | 'all' }>;

function uniqueLabel(label: string, taken: readonly PersonaSpec[]) {
  const used = new Set(taken.map(p => p.label.toLowerCase()));
  if (!used.has(label.toLowerCase())) return label;
  let n = 2;
  while (used.has(`${label} ${n}`.toLowerCase())) n += 1;
  return `${label} ${n}`;
}

function slug(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'persona';
}

/** Validate a draft and return a user persona. A label that collides with an
 * existing persona gets a numeric suffix ("Vector 2"), never a silent overwrite.
 * @throws on an empty label or rail, or an unknown instrument/capability/surface. */
export function composePersona(draft: PersonaDraft, existing: readonly PersonaSpec[]): PersonaSpec {
  const label = draft.label.trim();
  if (!label || label.length > 40) throw new Error('Persona name must be 1 to 40 characters');
  if (draft.rail.length === 0) throw new Error('A persona needs at least one instrument');
  for (const id of draft.rail) if (!INSTRUMENT_IDS.has(id)) throw new Error(`Unknown instrument '${id}'`);
  for (const id of draft.capabilities) if (!CAPABILITY_BY_ID.has(id)) throw new Error(`Unknown capability '${id}'`);
  const surfaces = draft.surfaces === undefined ? 'all' : draft.surfaces;
  if (surfaces !== 'all') {
    if (surfaces.length === 0) throw new Error('A persona needs at least one surface');
    for (const s of surfaces) if (!PERSONA_SURFACES.includes(s)) throw new Error(`Unknown surface '${s}'`);
  }
  const finalLabel = uniqueLabel(label, existing);
  const ids = new Set(existing.map(p => p.id));
  let id = `custom.${slug(finalLabel)}`;
  for (let n = 2; ids.has(id); n += 1) id = `custom.${slug(finalLabel)}-${n}`;
  return { id, label: finalLabel, rail: [...new Set(draft.rail)], capabilities: [...new Set(draft.capabilities)], surfaces, builtIn: false };
}

/** Persona export format version. */
export const PERSONA_FORMAT = 1;

/** Serialize a user persona for sharing. Built-in personas are not exported. */
export function exportPersona(persona: PersonaSpec): string {
  if (persona.builtIn) throw new Error(`'${persona.label}' is built in and cannot be exported`);
  const { label, rail, capabilities, surfaces } = persona;
  return JSON.stringify({ format: PERSONA_FORMAT, label, rail, capabilities, surfaces });
}

/** Parse an exported persona from untrusted JSON and compose it against
 * `existing`, resolving name conflicts by suffix.
 * @throws on malformed JSON, an unsupported format, or invalid fields. */
export function importPersona(json: string, existing: readonly PersonaSpec[]): PersonaSpec {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('Persona file is not valid JSON'); }
  if (typeof raw !== 'object' || raw === null) throw new Error('Persona file must be a JSON object');
  const o = raw as Record<string, unknown>;
  if (o.format !== PERSONA_FORMAT) throw new Error(`Unsupported persona format ${String(o.format)}; expected ${PERSONA_FORMAT}`);
  const strings = (v: unknown, field: string) => {
    if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw new Error(`Persona '${field}' must be a list of strings`);
    return v as string[];
  };
  if (typeof o.label !== 'string') throw new Error("Persona 'label' must be a string");
  const surfaces = o.surfaces === 'all' ? 'all' : strings(o.surfaces, 'surfaces') as PersonaSurface[];
  return composePersona({ label: o.label, rail: strings(o.rail, 'rail'), capabilities: strings(o.capabilities, 'capabilities'), surfaces }, existing);
}
