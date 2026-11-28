// Portions ported from GridCraft for Android,
// apps/gridcraft-android/android/app/src/main/java/io/github/artcraftandroid/gridcraft/ui/editor/FormulaRefs.kt
// at https://github.com/artcraft-android/gridcraft-android/commit/72d5bfc0729d0966e9bd966c2eabaa0312eea3ff
// Copyright (c) 2026 ArtCraft Team and the GridCraft contributors.
// Licensed under the MIT License or the Apache License, Version 2.0, at your option;
// see licenses/GridCraft-MIT.txt and licenses/GridCraft-Apache-2.0.txt.
// Modified by NYC-Tron UI contributors, 2026-11-05: rewritten in TypeScript; reference
// tokenizing comes from ../formula-refs.ts; Compose Color values replaced with a tone index
// the app maps to its own theme tokens; segments for React Native nested Text added.
import { formulaReferences } from "../formula-refs.ts";
import type { SheetRange } from "../sheet-window.ts";

/**
 * Number of distinct reference tones. Each tone index maps to one of the
 * theme-token recipes in {@linkcode REFERENCE_TONE_CLASSES}; GridCraft uses
 * seven colors, and four token colors with a solid and a dashed outline give
 * eight distinguishable tones.
 */
export const REFERENCE_TONE_COUNT = 8;

/** One reference in a formula with the tone it is drawn in. */
export interface ColoredReference {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** `undefined` for the current sheet. */
  readonly sheet?: string;
  readonly range: SheetRange;
  /** `0..REFERENCE_TONE_COUNT-1`. The same reference keeps one tone wherever it appears. */
  readonly tone: number;
  /** `true` when the reference points at the sheet shown in the grid. */
  readonly onSheet: boolean;
}

/** Normalized key: `$` markers and letter case do not change a reference's tone. */
function referenceKey(text: string): string {
  return text.replaceAll("$", "").toUpperCase();
}

/**
 * Colored references in a formula, GridCraft style: the first distinct
 * reference gets tone 0, the next tone 1, and a repeated reference reuses its
 * tone. References to other sheets keep their tone in the formula text but
 * are marked `onSheet: false`, since the grid cannot outline them.
 */
export function colorReferences(formula: string, sheetName?: string): ColoredReference[] {
  const current = sheetName?.toLowerCase();
  const tones = new Map<string, number>();
  return formulaReferences(formula).map(ref => {
    const key = referenceKey(ref.text);
    let tone = tones.get(key);
    if (tone === undefined) {
      tone = tones.size % REFERENCE_TONE_COUNT;
      tones.set(key, tone);
    }
    const onSheet = ref.sheet === undefined || (current !== undefined && ref.sheet.toLowerCase() === current);
    return ref.sheet === undefined
      ? { text: ref.text, start: ref.start, end: ref.end, range: ref.range, tone, onSheet }
      : { text: ref.text, start: ref.start, end: ref.end, sheet: ref.sheet, range: ref.range, tone, onSheet };
  });
}

/** A run of formula text; `tone` is set for runs that are references. */
export interface FormulaSegment {
  readonly text: string;
  readonly tone?: number;
}

/** Splits a formula into plain and reference runs for nested-Text rendering. */
export function formulaSegments(formula: string, references: readonly ColoredReference[]): FormulaSegment[] {
  const out: FormulaSegment[] = [];
  let at = 0;
  for (const ref of [...references].sort((a, b) => a.start - b.start)) {
    if (ref.start < at) continue;
    if (ref.start > at) out.push({ text: formula.slice(at, ref.start) });
    out.push({ text: formula.slice(ref.start, ref.end), tone: ref.tone });
    at = ref.end;
  }
  if (at < formula.length) out.push({ text: formula.slice(at) });
  return out;
}

/** Literal Tailwind recipes per tone, so a source scan finds every class. */
export interface ReferenceToneClasses {
  /** Formula-bar text color. */
  readonly text: string;
  /** Translucent cell fill. */
  readonly fill: string;
  /** Outline edges of the referenced block. */
  readonly top: string;
  readonly bottom: string;
  readonly start: string;
  readonly end: string;
}
const tone = (color: "primary" | "accent" | "success" | "info", dashed: boolean): ReferenceToneClasses => {
  const style = dashed ? " border-dashed" : "";
  switch (color) {
    case "primary": return { text: "text-primary", fill: "bg-primary/10",
      top: "border-t-2 border-t-primary" + style, bottom: "border-b-2 border-b-primary" + style,
      start: "border-s-2 border-s-primary" + style, end: "border-e-2 border-e-primary" + style };
    case "accent": return { text: "text-accent", fill: "bg-accent/10",
      top: "border-t-2 border-t-accent" + style, bottom: "border-b-2 border-b-accent" + style,
      start: "border-s-2 border-s-accent" + style, end: "border-e-2 border-e-accent" + style };
    case "success": return { text: "text-success", fill: "bg-success/10",
      top: "border-t-2 border-t-success" + style, bottom: "border-b-2 border-b-success" + style,
      start: "border-s-2 border-s-success" + style, end: "border-e-2 border-e-success" + style };
    case "info": return { text: "text-info", fill: "bg-info/10",
      top: "border-t-2 border-t-info" + style, bottom: "border-b-2 border-b-info" + style,
      start: "border-s-2 border-s-info" + style, end: "border-e-2 border-e-info" + style };
  }
};
/**
 * Token recipes indexed by {@linkcode ColoredReference.tone}. Only theme
 * tokens; `danger` is left out so a reference never reads as an error.
 */
export const REFERENCE_TONE_CLASSES: readonly ReferenceToneClasses[] = [
  tone("primary", false), tone("accent", false), tone("success", false), tone("info", false),
  tone("primary", true), tone("accent", true), tone("success", true), tone("info", true),
];

/** Which outline edges a cell draws for a referenced block it belongs to. */
export function referenceEdges(range: SheetRange, row: number, column: number): {
  top: boolean; bottom: boolean; start: boolean; end: boolean;
} {
  return {
    top: row === range.startRow, bottom: row === range.endRow,
    start: column === range.startColumn, end: column === range.endColumn,
  };
}
