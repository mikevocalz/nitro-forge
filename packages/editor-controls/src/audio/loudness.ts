/**
 * Display math for {@linkcode LoudnessMeter}. The numbers come from the app's
 * audio engine (Cadence `loudness` over an offline mixdown: BS.1770
 * K-weighted, gated). This file only formats them, compares them with a
 * target and reduces the momentary history to a bounded number of bars.
 *
 * The engine reports no loudness range (LRA) and no true peak, so nothing
 * here computes or labels either. Sample peak is not true peak: inter-sample
 * overs can sit up to a few dB above it.
 */

/** Bottom of the fixed history scale, in LUFS. Quieter blocks draw empty. */
export const LOUDNESS_FLOOR_LUFS = -60;
/** Top of the fixed history scale, in LUFS. */
export const LOUDNESS_CEILING_LUFS = 0;

/** A selectable integrated-loudness target for {@linkcode LoudnessMeter}. */
export interface LoudnessTarget {
  /** Target integrated loudness, in LUFS. */
  readonly lufs: number;
  /** Short name shown under the value. */
  readonly label: string;
}

/**
 * Default target choices: -14 LUFS (common streaming normalization),
 * -16 LUFS (common podcast delivery) and -23 LUFS (EBU R 128 broadcast).
 */
export const LOUDNESS_TARGETS = [
  { lufs: -14, label: "Streaming" },
  { lufs: -16, label: "Podcast" },
  { lufs: -23, label: "Broadcast" },
] as const satisfies readonly LoudnessTarget[];

/** Default target, in LUFS. */
export const DEFAULT_LOUDNESS_TARGET = -14;

const MINUS = "−";

/** Formats a signed number with one decimal and a typographic minus. */
export function formatSigned(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  const zero = Number(fixed) === 0;
  return (value < 0 && !zero ? MINUS : "") + fixed;
}

/** `-14.2` to "−14.2 LUFS"; `null` (silent or too short) to "No reading". */
export function formatLufs(lufs: number | null): string {
  return lufs === null || !Number.isFinite(lufs) ? "No reading" : formatSigned(lufs) + " LUFS";
}

/** `-0.4` to "−0.4 dBFS"; `null` to "No reading". */
export function formatDbfs(dbfs: number | null): string {
  return dbfs === null || !Number.isFinite(dbfs) ? "No reading" : formatSigned(dbfs) + " dBFS";
}

/** How the integrated loudness sits against the target. */
export interface TargetDelta {
  /** Distance from the target in LU, rounded to 0.1, always >= 0. */
  readonly lu: number;
  /** `on` when the rounded distance is 0.0 LU. */
  readonly direction: "over" | "under" | "on";
  /** "1.8 LU over target", "0.6 LU under target" or "On target". */
  readonly text: string;
}

/**
 * Compares integrated loudness with `target`. Returns `undefined` when there
 * is no integrated reading.
 */
export function targetDelta(integratedLufs: number | null, target: number): TargetDelta | undefined {
  if (integratedLufs === null || !Number.isFinite(integratedLufs)) return undefined;
  const diff = Math.round((integratedLufs - target) * 10) / 10;
  if (diff === 0) return { lu: 0, direction: "on", text: "On target" };
  const lu = Math.abs(diff);
  const direction = diff > 0 ? "over" : "under";
  return { lu, direction, text: lu.toFixed(1) + " LU " + direction + " target" };
}

/** Peak severity. `near` is above -1 dBFS, `over` above 0 dBFS. */
export type PeakSeverity = "none" | "ok" | "near" | "over";

/** Classifies a sample peak for the warning line under it. */
export function peakSeverity(dbfs: number | null): PeakSeverity {
  if (dbfs === null || !Number.isFinite(dbfs)) return "none";
  if (dbfs > 0) return "over";
  if (dbfs > -1) return "near";
  return "ok";
}

/** Warning text per {@linkcode PeakSeverity}; empty when there is nothing to warn about. */
export const PEAK_WARNINGS = {
  none: "",
  ok: "",
  near: "Within 1 dB of full scale",
  over: "Over 0 dBFS, the mixdown clips",
} as const satisfies Record<PeakSeverity, string>;

/** Position of `lufs` on the fixed scale, 0 at the floor and 1 at 0 LUFS. */
export function lufsToFraction(lufs: number): number {
  if (!Number.isFinite(lufs)) return 0;
  const f = (lufs - LOUDNESS_FLOOR_LUFS) / (LOUDNESS_CEILING_LUFS - LOUDNESS_FLOOR_LUFS);
  return Math.min(1, Math.max(0, f));
}

/** One drawn bar of the momentary history. */
export interface MomentaryBar {
  /** Loudest block in this bar, in LUFS; `null` when every block was silent. */
  readonly lufs: number | null;
  /** Height on the fixed scale, in [0, 1]. 0 for a silent bar. */
  readonly fraction: number;
}

/**
 * Max-pools the momentary history (one 400 ms block every `stepSeconds`)
 * into at most `maxBars` bars, so the drawn view count stays bounded however
 * long the range is. Each bar keeps the loudest block it covers.
 */
export function momentaryBars(momentary: readonly (number | null)[], maxBars: number): MomentaryBar[] {
  if (!Number.isInteger(maxBars) || maxBars < 1) throw new RangeError("maxBars must be an integer >= 1");
  const count = Math.min(maxBars, momentary.length);
  const bars: MomentaryBar[] = [];
  for (let b = 0; b < count; b++) {
    const from = Math.floor(b * momentary.length / count);
    const to = Math.floor((b + 1) * momentary.length / count);
    let best: number | null = null;
    for (let i = from; i < to; i++) {
      const v = momentary[i];
      if (v !== null && v !== undefined && Number.isFinite(v) && (best === null || v > best)) best = v;
    }
    bars.push({ lufs: best, fraction: best === null ? 0 : lufsToFraction(best) });
  }
  return bars;
}

/** Bars to draw for a measured width: one bar per 4 pt, at most 120. */
export function barCountForWidth(widthPt: number, momentaryLength: number): number {
  const byWidth = Math.floor(Math.max(0, widthPt) / 4);
  return Math.max(1, Math.min(120, byWidth, Math.max(1, momentaryLength)));
}

/** Seconds covered by the momentary history (block starts every `stepSeconds`, last block 0.4 s long). */
export function historySeconds(momentaryLength: number, stepSeconds: number): number {
  if (momentaryLength <= 0) return 0;
  return (momentaryLength - 1) * stepSeconds + 0.4;
}

/** Seconds as "12.3 s". */
export function formatSeconds(seconds: number): string {
  return (Math.round(seconds * 10) / 10).toFixed(1) + " s";
}

/** Readings summarized by {@linkcode describeLoudness}. */
export interface LoudnessReadings {
  readonly integratedLufs: number | null;
  readonly shortTermMaxLufs: number | null;
  readonly momentaryMaxLufs: number | null;
  readonly samplePeakDbfs: number | null;
  readonly target: number;
}

/**
 * One sentence for screen readers: integrated value, distance to target,
 * maxima and the peak warning.
 */
export function describeLoudness(r: LoudnessReadings): string {
  const parts = ["Integrated " + formatLufs(r.integratedLufs)];
  const delta = targetDelta(r.integratedLufs, r.target);
  if (delta) parts.push(delta.text + " of " + formatLufs(r.target));
  parts.push("short-term max " + formatLufs(r.shortTermMaxLufs));
  parts.push("momentary max " + formatLufs(r.momentaryMaxLufs));
  parts.push("sample peak " + formatDbfs(r.samplePeakDbfs));
  const warning = PEAK_WARNINGS[peakSeverity(r.samplePeakDbfs)];
  return parts.join(", ") + "." + (warning ? " " + warning + "." : "");
}
