// Pure fold/window geometry. No react-native import: the calculations stay
// node-testable and both iOS reserved regions and Android FoldingFeature data
// enter through the same shape.
// SOT-KEYWORDS: adaptive panes fold hinge folding feature posture tabletop book snap split
import type {
  FoldOcclusionType,
  FoldOrientation,
  FoldState,
  ReservedRegion,
} from './reserved-regions.types';

export type FoldPosture = 'flat' | 'book' | 'tabletop';

export interface FoldLayout {
  orientation: FoldOrientation;
  state: FoldState;
  posture: FoldPosture;
  occlusionType?: FoldOcclusionType | undefined;
  separating: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VerticalFoldPanePlan {
  splitAfter: 'primary' | 'supplementary';
  primaryWidth: number;
  supplementaryWidth: number;
  gapWidth: number;
}

export interface VerticalFoldPanePlanInput {
  fold: FoldLayout | null;
  rowWidth: number | null;
  primaryVisible: boolean;
  supplementaryVisible: boolean;
  detailVisible: boolean;
  primaryWidth: number;
  supplementaryWidth: number;
  detailMinWidth: number;
  paneMinWidth: number;
}


export interface VerticalMultiFoldPanePlan {
  primaryWidth: number;
  supplementaryWidth: number;
  gapAfterPrimary: number;
  gapAfterSupplementary: number;
}

export interface VerticalMultiFoldPanePlanInput {
  folds: readonly FoldLayout[];
  rowWidth: number | null;
  primaryVisible: boolean;
  supplementaryVisible: boolean;
  detailVisible: boolean;
  primaryWidth: number;
  supplementaryWidth: number;
  detailMinWidth: number;
  paneMinWidth: number;
}

export function foldLayoutsIntersectingRow(
  folds: readonly FoldLayout[],
  rowWidth: number | null,
): FoldLayout[] {
  if (rowWidth === null) return [];

  return folds.filter((fold) => {
    const foldEnd = fold.x + Math.max(0, fold.width);
    // A zero-width separating crease is still a real boundary when it falls
    // inside the row. Folds wholly before/after a nested row are irrelevant to
    // that row and must not participate in primary-hinge selection.
    return fold.x < rowWidth && (fold.width === 0 ? fold.x > 0 : foldEnd > 0);
  });
}

/**
 * Normalize the current physical division into the pane row's local coordinates.
 *
 * UIKit's division region does not carry Android's explicit orientation/state,
 * so those two values are inferred conservatively. Android metadata always wins
 * when present.
 */
export function foldLayoutsFromRegions(
  regions: readonly ReservedRegion[],
  windowOriginX = 0,
): FoldLayout[] {
  return regions
    .filter((candidate) => candidate.kind === 'division')
    .map((region) => {
      const orientation: FoldOrientation =
        region.orientation ?? (region.height >= region.width ? 'vertical' : 'horizontal');
      const state: FoldState = region.state ?? 'flat';
      const posture: FoldPosture =
        state === 'halfOpened'
          ? orientation === 'horizontal'
            ? 'tabletop'
            : 'book'
          : 'flat';

      return {
        orientation,
        state,
        posture,
        occlusionType: region.occlusionType,
        // Android tells us directly. UIKit's active division is the equivalent
        // signal; an inactive zero-width Duo division must not rearrange panes.
        // FULL occlusion is always treated as separating even if a vendor emits
        // an inconsistent isSeparating value.
        separating:
          (region.separating ?? region.active) ||
          region.occlusionType === 'full',
        // Preserve negative local x values: a fold can sit completely to the
        // left of a nested pane row. Clamping it to zero would turn an off-row
        // hinge into a phantom hinge on the row's leading edge.
        x: region.x - windowOriginX,
        y: region.y,
        width: Math.max(0, region.width),
        height: Math.max(0, region.height),
      };
    })
    .sort((a, b) => {
      if (a.orientation === b.orientation) {
        return a.orientation === 'vertical' ? a.x - b.x : a.y - b.y;
      }
      // Stable deterministic ordering for mixed-orientation reports.
      return a.orientation === 'vertical' ? -1 : 1;
    });
}

/**
 * Backward-compatible single-fold view for consumers whose layout can currently
 * place only one boundary. New capability decisions (navigation posture,
 * trifold region modelling) should use foldLayoutsFromRegions().
 */
export function foldLayoutFromRegions(
  regions: readonly ReservedRegion[],
  windowOriginX = 0,
): FoldLayout | null {
  return foldLayoutsFromRegions(regions, windowOriginX)[0] ?? null;
}

/**
 * Snap a horizontal pane composition to a separating VERTICAL fold without
 * choosing product content for the caller.
 *
 * Preference:
 * 1. Keep primary + supplementary together on the leading physical region when
 *    both fit; detail gets the trailing region.
 * 2. Otherwise put primary alone on the leading region and shrink the
 *    supplementary pane inside the trailing region while defending detail's
 *    floor.
 *
 * If neither arrangement is usable, return null and preserve the existing
 * width-class layout instead of silently hiding a pane.
 */
export function resolveVerticalFoldPanePlan({
  fold,
  rowWidth,
  primaryVisible,
  supplementaryVisible,
  detailVisible,
  primaryWidth,
  supplementaryWidth,
  detailMinWidth,
  paneMinWidth,
}: VerticalFoldPanePlanInput): VerticalFoldPanePlan | null {
  if (
    !fold ||
    !fold.separating ||
    fold.orientation !== 'vertical' ||
    rowWidth === null ||
    !detailVisible
  ) {
    return null;
  }

  const gapWidth = Math.min(fold.width, Math.max(0, rowWidth - fold.x));
  const leadingWidth = Math.min(Math.max(0, fold.x), rowWidth);
  const trailingWidth = Math.max(0, rowWidth - leadingWidth - gapWidth);

  if (leadingWidth < paneMinWidth || trailingWidth < detailMinWidth) {
    return null;
  }

  if (supplementaryVisible) {
    // Best case: both authored leading panes stay on the leading physical
    // region, with the hinge becoming the supplementary/detail boundary.
    const primaryOnLeading = primaryVisible ? primaryWidth : 0;
    const supplementaryOnLeading = leadingWidth - primaryOnLeading;
    if (
      supplementaryOnLeading >= paneMinWidth &&
      (!primaryVisible || primaryOnLeading >= paneMinWidth)
    ) {
      return {
        splitAfter: 'supplementary',
        primaryWidth,
        supplementaryWidth: supplementaryOnLeading,
        gapWidth,
      };
    }

    // The leading region cannot hold both. Keep the first pane on the first
    // physical region and fit supplementary + detail on the second. We do not
    // hide either pane here; visibility remains the host's policy.
    if (
      primaryVisible &&
      trailingWidth >= paneMinWidth + detailMinWidth
    ) {
      return {
        splitAfter: 'primary',
        primaryWidth: leadingWidth,
        supplementaryWidth: Math.max(
          paneMinWidth,
          Math.min(supplementaryWidth, trailingWidth - detailMinWidth),
        ),
        gapWidth,
      };
    }

    return null;
  }

  if (primaryVisible) {
    return {
      splitAfter: 'primary',
      primaryWidth: leadingWidth,
      supplementaryWidth,
      gapWidth,
    };
  }

  return null;
}


/**
 * Trifold / multi-hinge planner.
 *
 * AdaptivePanes can author at most three tiled panes (primary,
 * supplementary, detail), so when at least two separating vertical hinges are
 * present we choose the pair that best maps those three panes one-per-physical
 * region. This prevents any of the three from straddling either hinge.
 *
 * Two-pane layouts still use the single-hinge planner; with only two authored
 * panes there is no honest way to avoid two distinct hinge gaps without
 * inventing a fourth internal content region.
 */
export function resolveVerticalMultiFoldPanePlan({
  folds,
  rowWidth,
  primaryVisible,
  supplementaryVisible,
  detailVisible,
  primaryWidth,
  supplementaryWidth,
  detailMinWidth,
  paneMinWidth,
}: VerticalMultiFoldPanePlanInput): VerticalMultiFoldPanePlan | null {
  if (
    rowWidth === null ||
    !primaryVisible ||
    !supplementaryVisible ||
    !detailVisible
  ) {
    return null;
  }

  const vertical = folds
    .filter(
      (fold) =>
        fold.separating &&
        fold.orientation === 'vertical' &&
        fold.x > 0 &&
        fold.x < rowWidth,
    )
    .sort((a, b) => a.x - b.x);

  if (vertical.length < 2) return null;

  let best:
    | (VerticalMultiFoldPanePlan & { score: number })
    | null = null;

  for (let firstIndex = 0; firstIndex < vertical.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < vertical.length; secondIndex += 1) {
      const first = vertical[firstIndex]!;
      const second = vertical[secondIndex]!;

      const firstStart = Math.max(0, Math.min(rowWidth, first.x));
      const firstEnd = Math.max(
        firstStart,
        Math.min(rowWidth, first.x + first.width),
      );
      const secondStart = Math.max(firstEnd, Math.min(rowWidth, second.x));
      const secondEnd = Math.max(
        secondStart,
        Math.min(rowWidth, second.x + second.width),
      );

      const firstRegion = firstStart;
      const secondRegion = secondStart - firstEnd;
      const thirdRegion = rowWidth - secondEnd;

      if (
        firstRegion < paneMinWidth ||
        secondRegion < paneMinWidth ||
        thirdRegion < detailMinWidth
      ) {
        continue;
      }

      const score =
        Math.abs(firstRegion - primaryWidth) +
        Math.abs(secondRegion - supplementaryWidth);

      if (best === null || score < best.score) {
        best = {
          primaryWidth: firstRegion,
          supplementaryWidth: secondRegion,
          gapAfterPrimary: firstEnd - firstStart,
          gapAfterSupplementary: secondEnd - secondStart,
          score,
        };
      }
    }
  }

  if (!best) return null;

  return {
    primaryWidth: best.primaryWidth,
    supplementaryWidth: best.supplementaryWidth,
    gapAfterPrimary: best.gapAfterPrimary,
    gapAfterSupplementary: best.gapAfterSupplementary,
  };
}


export interface TrailingInspectorLayout {
  width: number;
  edge: 'left' | 'right';
  /** Translation that parks the inspector fully beyond its trailing edge. */
  closedX: number;
}

export interface TrailingInspectorLayoutInput {
  folds: readonly FoldLayout[];
  rowWidth: number | null;
  preferredWidth: number;
  isRTL: boolean;
}

/**
 * Match SplitView.Inspector's trailing-edge overlay semantics while respecting
 * a separating vertical fold.
 *
 * The inspector never becomes another tiled column. It overlays the detail
 * surface from the logical trailing edge, and on a foldable its maximum width
 * is the physical region on that trailing side so it cannot cover the hinge or
 * spill into the opposite display.
 */
export function resolveTrailingInspectorLayout({
  folds,
  rowWidth,
  preferredWidth,
  isRTL,
}: TrailingInspectorLayoutInput): TrailingInspectorLayout {
  const edge: 'left' | 'right' = isRTL ? 'left' : 'right';
  let availableWidth = rowWidth ?? preferredWidth;

  if (rowWidth !== null) {
    const vertical = foldLayoutsIntersectingRow(folds, rowWidth)
      .filter((fold) => fold.separating && fold.orientation === 'vertical')
      .sort((a, b) => a.x - b.x);

    if (vertical.length > 0) {
      if (isRTL) {
        const first = vertical[0]!;
        availableWidth = Math.min(Math.max(0, first.x), rowWidth);
      } else {
        const last = vertical[vertical.length - 1]!;
        const foldEnd = Math.min(
          rowWidth,
          Math.max(0, last.x + last.width),
        );
        availableWidth = Math.max(0, rowWidth - foldEnd);
      }
    }
  }

  const width = Math.max(0, Math.min(preferredWidth, availableWidth));
  // Twenty dp clears the shadow/edge completely instead of leaving a sliver.
  const travel = width + 20;

  return {
    width,
    edge,
    closedX: isRTL ? -travel : travel,
  };
}
