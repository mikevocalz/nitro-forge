/** Pure state and copy for the Persona Composer. The view in
 * `persona-composer.tsx` renders this; `PersonaStore.compose` stays the only
 * path that validates and saves a persona.
 */
import { forgeInstrumentBlueprints, type InstrumentBlueprint } from './instrument-system.ts';
import {
  PERSONA_SURFACES, personaCapabilities, personaManifest,
  type PersonaCapability, type PersonaDraft, type PersonaManifest, type PersonaSpec, type PersonaSurface,
} from './persona.ts';

/** Longest persona name `composePersona` accepts. */
export const PERSONA_NAME_MAX = 40;

/** Instruments the design studio can put on a rail: studios include 'prism' or 'all'. */
export const designStudioInstruments: readonly InstrumentBlueprint[] = forgeInstrumentBlueprints.filter(i =>
  i.studios === 'all' || i.studios.includes('prism'));

const INSTRUMENT_LABEL = new Map(forgeInstrumentBlueprints.map(i => [i.id, i.label]));

/** Display name for an instrument id, or the id itself when unknown. */
export function instrumentLabel(id: string): string {
  return INSTRUMENT_LABEL.get(id) ?? id;
}

/** Plain surface names as the composer shows them. */
export const SURFACE_LABELS: Readonly<Record<PersonaSurface, string>> = {
  iphone: 'iPhone', ipad: 'iPad', 'android-phone': 'Android phone', 'android-foldable': 'Android foldable',
  web: 'Web', desktop: 'Desktop', xr: 'XR',
};

/** Surface names inside a sentence: "works on the web", "on Android phones". */
export const SURFACE_PROSE: Readonly<Record<PersonaSurface, string>> = {
  iphone: 'iPhone', ipad: 'iPad', 'android-phone': 'Android phones', 'android-foldable': 'Android foldables',
  web: 'the web', desktop: 'desktop', xr: 'XR',
};

/** Whether the persona appears on every surface or on a chosen list. */
export type SurfaceMode = 'all' | 'chosen';

/** Everything the composer form holds before Save. */
export type ComposerDraft = Readonly<{
  label: string;
  rail: readonly string[];
  capabilities: readonly string[];
  surfaceMode: SurfaceMode;
  surfaces: readonly PersonaSurface[];
}>;

/** A fresh form: empty name, empty rail, every surface. */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = { label: '', rail: [], capabilities: [], surfaceMode: 'all', surfaces: [] };

/** Add `id` when absent, remove it when present. Order of the rest is kept. */
export function toggleId<T extends string>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

/** Move the rail item at `index` by `delta` places. Out-of-range moves return the rail unchanged. */
export function moveRailItem(rail: readonly string[], index: number, delta: number): string[] {
  const to = index + delta;
  if (index < 0 || index >= rail.length || to < 0 || to >= rail.length || delta === 0) return [...rail];
  const next = [...rail];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Target index for a vertical drag of row `startIndex` by `deltaY` points,
 * using measured row heights in display order. Independent of window or page
 * coordinates, so scroll offset never shifts the drop. */
export function dragTargetIndex(startIndex: number, deltaY: number, rowHeights: readonly number[]): number {
  const count = rowHeights.length;
  if (count === 0 || startIndex < 0 || startIndex >= count || !Number.isFinite(deltaY)) return Math.max(0, Math.min(startIndex, count - 1));
  let target = startIndex;
  let remaining = deltaY;
  if (remaining > 0) {
    while (target < count - 1) {
      const step = ((rowHeights[target] ?? 0) + (rowHeights[target + 1] ?? 0)) / 2;
      if (step <= 0 || remaining < step) break;
      remaining -= step; target += 1;
    }
  } else {
    while (target > 0) {
      const step = ((rowHeights[target] ?? 0) + (rowHeights[target - 1] ?? 0)) / 2;
      if (step <= 0 || -remaining < step) break;
      remaining += step; target -= 1;
    }
  }
  return target;
}

/** The draft as `PersonaStore.compose` takes it. */
export function toPersonaDraft(draft: ComposerDraft): PersonaDraft {
  return {
    label: draft.label, rail: draft.rail, capabilities: draft.capabilities,
    surfaces: draft.surfaceMode === 'all' ? 'all' : PERSONA_SURFACES.filter(s => draft.surfaces.includes(s)),
  };
}

/** Why Save is off, in plain words, or undefined when the draft can be saved. */
export function saveBlocker(draft: ComposerDraft): string | undefined {
  const name = draft.label.trim();
  if (!name) return 'Name the persona to save it';
  if (name.length > PERSONA_NAME_MAX) return `Shorten the name to ${PERSONA_NAME_MAX} characters`;
  if (draft.rail.length === 0) return 'Add an instrument to the rail to save';
  if (draft.surfaceMode === 'chosen' && draft.surfaces.length === 0) return 'Pick at least one surface to save';
  return undefined;
}

/** Name counter under the field: "12 of 40". */
export function nameCounter(label: string): string {
  return `${label.trim().length} of ${PERSONA_NAME_MAX}`;
}

/** Manifest the draft would produce on `surface`, before it is saved. */
export function draftManifest(draft: ComposerDraft, surface: PersonaSurface): PersonaManifest {
  const d = toPersonaDraft(draft);
  const spec: PersonaSpec = {
    id: 'draft', label: draft.label.trim() || 'This persona', rail: d.rail, capabilities: d.capabilities,
    surfaces: d.surfaces === undefined ? 'all' : d.surfaces.length === 0 ? [] : d.surfaces, builtIn: false,
  };
  return personaManifest(spec, surface);
}

/** Short tag shown next to a capability that will not work everywhere. */
export function capabilityTag(capability: PersonaCapability): string | undefined {
  if (capability.engine === 'not-in-engine') return 'Not in this build';
  if (capability.surfaces !== 'all') return `${joinWords(capability.surfaces.map(s => SURFACE_LABELS[s]))} only`;
  return undefined;
}

function joinWords(input: readonly string[]) {
  // Common nouns drop their capital after the first word; iPad, Android and XR keep theirs.
  const words = input.map((w, i) => i > 0 && (w === 'Web' || w === 'Desktop') ? w.toLowerCase() : w);
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Capabilities in catalog order, for the picker. */
export const composerCapabilities: readonly PersonaCapability[] = personaCapabilities;

/** Confirmation after Save or Import. Names the suffix when a conflict was resolved. */
export function savedMessage(verb: 'Saved' | 'Imported', requested: string, saved: PersonaSpec): string {
  const asked = requested.trim();
  return asked && asked.toLowerCase() !== saved.label.toLowerCase()
    ? `${verb} as ${saved.label}. ${asked} was already taken.`
    : `${verb} ${saved.label}`;
}

/** Read the label from untrusted import JSON without validating anything else. */
export function requestedImportLabel(json: string): string {
  try {
    const raw: unknown = JSON.parse(json);
    return typeof raw === 'object' && raw !== null && typeof (raw as { label?: unknown }).label === 'string' ? (raw as { label: string }).label : '';
  } catch { return ''; }
}

/** Screen-reader announcement after a rail move. */
export function moveAnnouncement(rail: readonly string[], id: string): string {
  return `${instrumentLabel(id)} moved to position ${rail.indexOf(id) + 1} of ${rail.length}`;
}
