import type { ReservedRegion } from '@nyc-tron/core/folds';
/** Where the persona panel lives on this window.
 *
 * - `dock`: a separating hinge splits the window. The panel sits in one pane,
 *   flush to the hinge-side edge, and never intersects the hinge.
 * - `sheet`: compact window with no hinge (phones, folded covers).
 * - `inline`: regular width; PrismEditor's own anchored panel is fine.
 *
 * Geometry is window coordinates in RN layout units, the shape
 * `useReservedRegions()` from `@nyc-tron/reserved-regions` returns.
 */
export type DockRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type DockInsets = Readonly<{ top: number; right: number; bottom: number; left: number }>;

/** The fields of NYC-Tron's ReservedRegion the planner reads. */
export type DockRegion = Readonly<Pick<ReservedRegion, 'kind' | 'x' | 'y' | 'width' | 'height' | 'active' | 'orientation' | 'separating'>>;

export type PersonaPlacement =
  | Readonly<{ mode: 'inline' }>
  | Readonly<{ mode: 'sheet' }>
  | Readonly<{ mode: 'dock'; rect: DockRect; pane: DockRect; hinge: DockRect; edge: 'leading' | 'trailing' | 'top' }>;

/** Below this width a tool panel becomes a sheet (interaction-policy.ts uses 600). */
export const PERSONA_SHEET_MAX_WIDTH = 600;
const MARGIN = 12;

/** A fold can be zero thickness (Pixel Fold reports a 0-width line); it still needs length. */
const finite = (r: DockRect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0 && r.width + r.height > 0;

/** UIKit division regions carry no `separating` flag; a division always splits panes there. */
function separatingHinge(regions: readonly DockRegion[]): DockRegion | undefined {
  return regions.find(r => r.kind === 'division' && r.active && r.separating !== false && finite(r));
}

function isVertical(hinge: DockRegion): boolean {
  return hinge.orientation ? hinge.orientation === 'vertical' : hinge.height >= hinge.width;
}

export function intersects(a: DockRect, b: DockRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function planPersonaPlacement(input: {
  window: Readonly<{ width: number; height: number }>;
  regions: readonly DockRegion[];
  insets: DockInsets;
  /** Panel size the turret needs; height is a ceiling, content may be shorter. */
  panel: Readonly<{ width: number; height: number }>;
  direction?: 'ltr' | 'rtl';
}): PersonaPlacement {
  const { window, insets, panel } = input;
  if (!(window.width > 0 && window.height > 0)) return { mode: 'sheet' };
  const hinge = separatingHinge(input.regions);
  if (!hinge) return window.width < PERSONA_SHEET_MAX_WIDTH ? { mode: 'sheet' } : { mode: 'inline' };

  const top = insets.top, bottom = window.height - insets.bottom;
  const left = insets.left, right = window.width - insets.right;
  if (isVertical(hinge)) {
    // Book posture or a dual-screen hinge: stage in the leading pane, the
    // instrument in the trailing pane, flush to the hinge.
    const leadingPane: DockRect = { x: left, y: top, width: hinge.x - left, height: bottom - top };
    const trailingPane: DockRect = { x: hinge.x + hinge.width, y: top, width: right - (hinge.x + hinge.width), height: bottom - top };
    const rtl = input.direction === 'rtl';
    const order: Array<[DockRect, 'leading' | 'trailing']> = rtl
      ? [[leadingPane, 'trailing'], [trailingPane, 'leading']]
      : [[trailingPane, 'leading'], [leadingPane, 'trailing']];
    for (const [pane, edge] of order) {
      if (pane.width < panel.width + 2 * MARGIN || pane.height < 2 * MARGIN + 44) continue;
      const width = panel.width;
      const height = Math.min(panel.height, pane.height - 2 * MARGIN);
      const x = pane.x === trailingPane.x && pane.width === trailingPane.width ? pane.x + MARGIN : pane.x + pane.width - MARGIN - width;
      const rect = { x, y: pane.y + MARGIN, width, height };
      return { mode: 'dock', rect, pane, hinge, edge };
    }
    return { mode: 'sheet' };
  }
  // Tabletop: the lower half rests on the table and takes the instrument,
  // its top edge against the hinge.
  const pane: DockRect = { x: left, y: hinge.y + hinge.height, width: right - left, height: bottom - (hinge.y + hinge.height) };
  if (pane.width < panel.width + 2 * MARGIN || pane.height < 2 * MARGIN + 44) return { mode: 'sheet' };
  const height = Math.min(panel.height, pane.height - 2 * MARGIN);
  const rect = { x: pane.x + (pane.width - panel.width) / 2, y: pane.y + MARGIN, width: panel.width, height };
  return { mode: 'dock', rect, pane, hinge, edge: 'top' };
}
