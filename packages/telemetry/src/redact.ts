import type { TelemetryAttributes, TelemetryValue } from "./types";

const IDENTIFIER = /^[\w.:-]{1,64}$/;

/**
 * Keeps attributes that cannot carry document content: finite numbers,
 * booleans and identifier-shaped strings. Returns the kept attributes and how
 * many were dropped.
 */
export function redactAttributes(attrs: Readonly<Record<string, unknown>> | undefined): {
  attrs: TelemetryAttributes;
  dropped: number;
} {
  const kept: Record<string, TelemetryValue> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(attrs ?? {})) {
    const ok =
      IDENTIFIER.test(key) &&
      ((typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean" ||
        (typeof value === "string" && IDENTIFIER.test(value)));
    if (ok) kept[key] = value as TelemetryValue;
    else dropped += 1;
  }
  return { attrs: kept, dropped };
}

/**
 * A failure message fit for an on-device bug report: file paths, URLs, long
 * numbers and quoted text are replaced, and it is cut to 160 characters.
 * Quoted text is where engines echo document content back.
 */
export function scrubMessage(message: string): string {
  return message
    .replace(/(["'`]).*?\1/g, "<text>")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/(?:~|\.{0,2})?\/(?:[^\s/]+\/)+[^\s/]*/g, "<path>")
    .replace(/\b\d{5,}\b/g, "<n>")
    .slice(0, 160);
}
