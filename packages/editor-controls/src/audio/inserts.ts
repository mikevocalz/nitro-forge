/**
 * Insert-chain and preset helpers for {@linkcode InsertEffectRack} and
 * {@linkcode PluginPresetBrowser}. Pure; no React or engine imports.
 *
 * Original implementation; no CapCraft source consulted. Built from the
 * Cadence insert contract: up to 8 ordered slots per track or bus, each a
 * gain, EQ or compressor that can be bypassed, moved or removed.
 */

/** Effect type of one insert slot, as the Cadence engine names it. */
export type InsertKind = "gain" | "eq" | "compressor";

/** Every {@linkcode InsertKind}, in the order the add picker lists them. */
export const INSERT_KINDS: readonly InsertKind[] = ["gain", "eq", "compressor"];

/** Display name of each {@linkcode InsertKind}. */
export const INSERT_KIND_LABELS = {
  gain: "Gain",
  eq: "EQ",
  compressor: "Compressor",
} as const satisfies Record<InsertKind, string>;

/** Engine limit on insert slots per track or bus. */
export const MAX_INSERTS = 8;

/** One insert slot, as passed to {@linkcode InsertEffectRack}. */
export interface InsertSlot {
  /** Stable engine id; also the React key. */
  readonly id: string;
  readonly kind: InsertKind;
  /** Committed bypass state. A bypassed slot passes audio unchanged. */
  readonly bypassed: boolean;
  /** Short parameter or preset summary, e.g. `"Vocal presence"`. */
  readonly summary?: string;
}

/** One factory or user preset, as passed to {@linkcode PluginPresetBrowser}. */
export interface InsertPreset {
  readonly id: string;
  readonly label: string;
}

/**
 * Why a new insert cannot be added, as visible text, or `undefined` when one
 * can. `max` is the slot limit.
 */
export function addBlockedReason(count: number, max: number = MAX_INSERTS): string | undefined {
  if (count < max) return undefined;
  return `All ${max} slots are in use. Remove an effect to add another.`;
}

/**
 * Index a slot lands on after one move of `direction` (-1 earlier, 1 later),
 * or `undefined` when it is already at that end of the chain.
 */
export function moveTarget(index: number, direction: -1 | 1, count: number): number | undefined {
  const next = index + direction;
  return next < 0 || next >= count ? undefined : next;
}

/** Spoken description of a slot, e.g. `"Slot 2 of 3, EQ, bypassed"`. */
export function describeInsert(slot: Pick<InsertSlot, "kind" | "bypassed" | "summary">, index: number, count: number): string {
  const parts = [`Slot ${index + 1} of ${count}`, INSERT_KIND_LABELS[slot.kind]];
  if (slot.summary) parts.push(slot.summary);
  if (slot.bypassed) parts.push("bypassed");
  return parts.join(", ");
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Presets whose label contains every word of `query`, ignoring case and
 * accents, in their original order. An empty query returns all presets.
 */
export function filterPresets<T extends Pick<InsertPreset, "label">>(presets: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...presets];
  return presets.filter(p => {
    const label = fold(p.label);
    return words.every(w => label.includes(w));
  });
}
