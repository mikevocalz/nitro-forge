import type { HsvColor } from "./color";
import { pointToHsv, type FieldPoint, type FieldSize } from "./fieldGeometry";

export interface FieldGestureOptions {
  readonly getSize: () => FieldSize;
  readonly getValue: () => HsvColor;
  readonly getDisabled: () => boolean;
  readonly onChange: (next: HsvColor) => void;
}

/**
 * Responder logic for the saturation/value field, kept free of React Native
 * so it can be tested directly.
 *
 * - Input is ignored until `onLayout` reports a positive size, so a touch
 *   before layout does nothing instead of throwing from a responder callback.
 * - While a drag is active the field refuses termination requests, so a
 *   parent ScrollView cannot take a vertical brightness drag.
 * - A forced platform cancel (`terminate` during a drag) restores the color
 *   from the start of the drag, matching UIKit/Android touch-cancel semantics.
 *   A normal release keeps the last color; the host's Cancel button is the
 *   way to discard a previewed color.
 */
export function createFieldGesture(options: FieldGestureOptions) {
  let active = false;
  let start: HsvColor | null = null;

  const measured = () => {
    const { width, height } = options.getSize();
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  };
  const apply = (point: FieldPoint) => {
    if (!active || !measured()) return;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    options.onChange(pointToHsv(point, options.getSize(), options.getValue()));
  };

  return {
    shouldStart: () => !options.getDisabled() && measured(),
    grant(point: FieldPoint) {
      if (options.getDisabled() || !measured()) return;
      active = true;
      start = options.getValue();
      apply(point);
    },
    move: apply,
    release() {
      active = false;
      start = null;
    },
    terminate() {
      if (active && start) options.onChange(start);
      active = false;
      start = null;
    },
    terminationRequest: () => !active,
  };
}
