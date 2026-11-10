/**
 * Forge 2046 interaction and adaptive overlay POLICY.
 *
 * Rendering/ownership: the host's NYC-Tron menu and sheet components, and a
 * future host Popover. This module never creates a React Native Modal,
 * browser portal or duplicate popup implementation.
 *
 * The host passes a measured, occlusion-free PANE (not the whole window);
 * fold/hinge geometry comes from @nyc-tron/reserved-regions, and safe-area
 * and window insets from the host.
 * No screen coordinates are persisted as workspace settings.
 */
export type ForgeMotionEvent =
  | 'hover' | 'press' | 'selection' | 'popover' | 'panel-dock'
  | 'detent' | 'commit' | 'cancel' | 'error';
export type ForgeInputKind = 'pointer' | 'touch' | 'pen' | 'keyboard' | 'accessibility' | 'controller';
export type ForgeRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ForgeInsets = Readonly<{ top: number; right: number; bottom: number; left: number }>;
export type ForgeOverlayKind = 'actions' | 'tool' | 'inspector' | 'palette';
export type ForgeOverlaySide = 'above' | 'below';

export type ForgeMotionProfile = Readonly<{
  durationMs: number;
  easing: 'standard' | 'emphasized' | 'linear' | 'instant';
  transformScale: number;
  travelPx: number;
  /** Haptics must be invoked by the actual host only on real supported input. */
  haptic: 'none' | 'selection' | 'impact-light' | 'error';
}>;

const presets: Readonly<Record<ForgeMotionEvent, ForgeMotionProfile>> = {
  hover: { durationMs: 70, easing: 'standard', transformScale: 1, travelPx: 0, haptic: 'none' },
  press: { durationMs: 90, easing: 'standard', transformScale: 0.985, travelPx: 0, haptic: 'impact-light' },
  selection: { durationMs: 120, easing: 'standard', transformScale: 1, travelPx: 0, haptic: 'selection' },
  popover: { durationMs: 150, easing: 'emphasized', transformScale: 0.98, travelPx: 5, haptic: 'none' },
  'panel-dock': { durationMs: 190, easing: 'emphasized', transformScale: 1, travelPx: 8, haptic: 'selection' },
  detent: { durationMs: 65, easing: 'linear', transformScale: 1, travelPx: 0, haptic: 'selection' },
  commit: { durationMs: 110, easing: 'standard', transformScale: 1, travelPx: 0, haptic: 'none' },
  cancel: { durationMs: 85, easing: 'standard', transformScale: 1, travelPx: 0, haptic: 'none' },
  error: { durationMs: 140, easing: 'standard', transformScale: 1, travelPx: 0, haptic: 'error' },
};

/** Durations are a design budget, NOT a measured animation or latency claim. */
export function forgeMotionProfile(event: ForgeMotionEvent, options?: { reducedMotion?: boolean; highContrast?: boolean }): ForgeMotionProfile {
  const preset = presets[event];
  if (!preset) throw new RangeError('unknown Forge motion event');
  // Respect reduced motion without suppressing semantic state or optional haptics.
  return options?.reducedMotion
    ? { ...preset, durationMs: 0, easing: 'instant', travelPx: 0, transformScale: 1 }
    : { ...preset, transformScale: options?.highContrast ? 1 : preset.transformScale };
}

export function forgeHitTarget(input: ForgeInputKind, density: 'compact' | 'comfortable' | 'presentation' = 'comfortable'): number {
  // Visual knobs may be 20px wide, but interactive target remains >=44 logical px.
  // A 48px default is useful for direct touch and pen, even in compact chrome.
  return (input === 'touch' || input === 'pen' || input === 'controller' || density === 'presentation') ? 48 : 44;
}

export type ForgeOverlayQuery = Readonly<{
  kind: ForgeOverlayKind;
  anchor: ForgeRect;
  /** The physical usable pane containing anchor, already excluding hinge. */
  pane: ForgeRect;
  desiredWidth: number;
  desiredHeight: number;
  input: ForgeInputKind;
  direction?: 'ltr' | 'rtl';
  insets?: Partial<ForgeInsets>;
  /** Height occupied by the visible software keyboard inside this pane. */
  keyboardHeight?: number;
}>;

export type ForgeOverlayPlan =
  | Readonly<{ presentation: 'sheet'; reason: 'compact' | 'occluded' | 'insufficient-space'; usable: ForgeRect }>
  | Readonly<{ presentation: 'anchored'; side: ForgeOverlaySide; rect: ForgeRect; scrollable: boolean; usable: ForgeRect }>;

/** Validate actual measured geometry instead of guessing from device category. */
function validRect(rect: ForgeRect, label: string): void {
  for (const value of [rect.x, rect.y, rect.width, rect.height]) {
    if (!Number.isFinite(value)) throw new RangeError(label + ' must be finite');
  }
  if (rect.width <= 0 || rect.height <= 0) throw new RangeError(label + ' must have positive area');
}
const clamp = (number: number, min: number, max: number) => Math.max(min, Math.min(max, number));

/**
 * Plans placement, never renders a popup. Native OS menus stay canonical
 * regardless of the plan, while a full-content tool popover can choose
 * a sheet on narrow or keyboard-covered usable panes.
 *
 * The host must pass the pane containing the trigger. When a separating
 * hinge divides a window, call this for the pane's local geometry only.
 */
export function planForgeOverlay(query: ForgeOverlayQuery): ForgeOverlayPlan {
  validRect(query.pane, 'pane');
  validRect(query.anchor, 'anchor');
  if (!Number.isFinite(query.desiredWidth) || query.desiredWidth <= 0
    || !Number.isFinite(query.desiredHeight) || query.desiredHeight <= 0)
    throw new RangeError('overlay dimensions must be finite and positive');
  const insets = { top: 0, right: 0, bottom: 0, left: 0, ...query.insets };
  for (const value of Object.values(insets)) if (!Number.isFinite(value) || value < 0) throw new RangeError('invalid safe insets');
  const keyboardHeight = query.keyboardHeight ?? 0;
  if (!Number.isFinite(keyboardHeight) || keyboardHeight < 0) throw new RangeError('invalid keyboard height');
  const margin = 8;
  const usable: ForgeRect = {
    x: query.pane.x + insets.left,
    y: query.pane.y + insets.top,
    width: Math.max(0, query.pane.width - insets.left - insets.right),
    height: Math.max(0, query.pane.height - insets.top - insets.bottom - keyboardHeight),
  };
  const withinAnchor = query.anchor.x >= usable.x
    && query.anchor.y >= usable.y
    && query.anchor.x + query.anchor.width <= usable.x + usable.width
    && query.anchor.y + query.anchor.height <= usable.y + usable.height;
  if (!withinAnchor || usable.width < 88 || usable.height < 100) {
    return { presentation: 'sheet', reason: 'occluded', usable };
  }
  // Inspector/palette content needs working room. A small phone or soft
  // keyboard converts it into the host's responsive sheet.
  if (query.kind !== 'actions' && (usable.width < 600 || usable.height < 350)) {
    return { presentation: 'sheet', reason: 'compact', usable };
  }
  const availableWidth = Math.max(0, usable.width - margin * 2);
  const width = Math.min(query.desiredWidth, availableWidth);
  const bottomSpace = usable.y + usable.height - margin - (query.anchor.y + query.anchor.height + 6);
  const topSpace = query.anchor.y - 6 - (usable.y + margin);
  const chooseBelow = bottomSpace >= query.desiredHeight || bottomSpace >= topSpace;
  const room = Math.max(0, chooseBelow ? bottomSpace : topSpace);
  // A clipped one-row popover isn't usable; call the host sheet instead.
  if (room < Math.min(88, query.desiredHeight) || width < 88) {
    return { presentation: 'sheet', reason: 'insufficient-space', usable };
  }
  const height = Math.min(query.desiredHeight, room);
  const rightAligned = (query.direction ?? 'ltr') !== 'rtl';
  const idealX = rightAligned ? query.anchor.x + query.anchor.width - width : query.anchor.x;
  const x = clamp(idealX, usable.x + margin, usable.x + usable.width - width - margin);
  const y = chooseBelow
    ? query.anchor.y + query.anchor.height + 6
    : query.anchor.y - 6 - height;
  return {
    presentation: 'anchored', side: chooseBelow ? 'below' : 'above',
    rect: { x, y, width, height }, scrollable: query.desiredHeight > height,
    usable,
  };
}
