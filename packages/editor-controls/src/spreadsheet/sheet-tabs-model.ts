/**
 * Tone of a sheet tab's color stripe. Tones map to theme tokens in
 * {@linkcode SheetTabs}; there are no free-form hex colors.
 */
export type SheetTabTone = "primary" | "accent" | "success" | "info" | "muted";

export const SHEET_TAB_TONES: readonly SheetTabTone[] = ["primary", "accent", "success", "info", "muted"];

/** One worksheet as {@linkcode SheetTabs} shows it. */
export interface SheetTab {
  /** Stable key the app chooses (the engine's sheet index or id). */
  readonly id: string;
  readonly name: string;
  readonly tone?: SheetTabTone;
  /** Shows a lock mark and hides rename/remove for this tab. */
  readonly isProtected?: boolean;
}

/** Longest sheet name spreadsheets accept. */
export const MAX_SHEET_NAME_LENGTH = 31;
const FORBIDDEN = /[\\/?*[\]:]/;

/**
 * Why a sheet name is rejected, or `undefined` when it is valid. Uses the
 * Excel naming rules (1–31 characters, none of `\ / ? * [ ] :`, no leading or
 * trailing apostrophe) and the case-insensitive uniqueness every engine
 * applies. `exceptId` skips the tab being renamed.
 */
export function sheetNameError(name: string, tabs: readonly SheetTab[], exceptId?: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Enter a sheet name.";
  if (trimmed.length > MAX_SHEET_NAME_LENGTH) return `Use ${MAX_SHEET_NAME_LENGTH} characters or fewer.`;
  if (FORBIDDEN.test(trimmed)) return "Sheet names can't contain \\ / ? * [ ] or :";
  if (trimmed.startsWith("'") || trimmed.endsWith("'")) return "Sheet names can't start or end with an apostrophe.";
  const lower = trimmed.toLowerCase();
  if (tabs.some(tab => tab.id !== exceptId && tab.name.toLowerCase() === lower)) {
    return `A sheet named "${trimmed}" already exists.`;
  }
  return undefined;
}

/** First free `Sheet<n>` name, matching the default engines give new sheets. */
export function nextSheetName(tabs: readonly SheetTab[], base = "Sheet"): string {
  const taken = new Set(tabs.map(tab => tab.name.toLowerCase()));
  for (let n = tabs.length + 1; ; n++) {
    const name = base + n;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Name for a copy: `Budget (2)`, `Budget (3)`, ... trimmed to the length limit. */
export function duplicateSheetName(name: string, tabs: readonly SheetTab[]): string {
  const taken = new Set(tabs.map(tab => tab.name.toLowerCase()));
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = name.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Tab id that keyboard navigation lands on, or `undefined` for an unhandled
 * key. Arrow keys follow reading direction, so in RTL ArrowLeft moves to the
 * next tab. Home and End jump to the ends.
 */
export function sheetTabKeyTarget(
  tabs: readonly SheetTab[], currentId: string, key: string, rtl = false,
): string | undefined {
  if (tabs.length === 0) return undefined;
  const at = Math.max(0, tabs.findIndex(tab => tab.id === currentId));
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const back = rtl ? "ArrowRight" : "ArrowLeft";
  let next: number;
  if (key === forward) next = Math.min(tabs.length - 1, at + 1);
  else if (key === back) next = Math.max(0, at - 1);
  else if (key === "Home") next = 0;
  else if (key === "End") next = tabs.length - 1;
  else return undefined;
  return tabs[next]!.id;
}

/** Target index for moving a tab one step, or `undefined` at an end. */
export function sheetTabMoveIndex(tabs: readonly SheetTab[], id: string, step: -1 | 1): number | undefined {
  const at = tabs.findIndex(tab => tab.id === id);
  if (at < 0) return undefined;
  const to = at + step;
  return to < 0 || to >= tabs.length ? undefined : to;
}
