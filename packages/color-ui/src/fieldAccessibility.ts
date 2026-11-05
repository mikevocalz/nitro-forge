import type { HsvColor } from "./color";
import { assertHsv } from "./fieldGeometry";

/** Brightness change for one screen-reader increment or decrement. */
export const FIELD_ACCESSIBILITY_STEP = 0.05;

/**
 * Screen-reader adjustment for the saturation/brightness field. The field is
 * announced as adjustable, so swipe up/down (VoiceOver) or volume keys
 * (TalkBack) must change something: they step brightness, the field's
 * vertical axis. Saturation has its own slider below the field.
 * Returns `undefined` for actions the field does not handle.
 */
export function adjustFieldForAccessibility(
  current: HsvColor,
  action: string,
): HsvColor | undefined {
  assertHsv(current);
  if (action !== "increment" && action !== "decrement") return undefined;
  const delta = action === "increment" ? FIELD_ACCESSIBILITY_STEP : -FIELD_ACCESSIBILITY_STEP;
  // Round to the step grid so repeated steps land on 0 and 1 exactly.
  const v = Math.round((current.v + delta) / FIELD_ACCESSIBILITY_STEP) * FIELD_ACCESSIBILITY_STEP;
  return { ...current, v: Math.max(0, Math.min(1, v)) };
}

/** Hue in whole degrees for display: 359.6 shows as 0°, never 360°. */
export function displayHueDegrees(h: number): number {
  if (!Number.isFinite(h)) throw new RangeError("Hue must be finite");
  return ((Math.round(h) % 360) + 360) % 360;
}
