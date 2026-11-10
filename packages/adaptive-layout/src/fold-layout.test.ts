import assert from 'node:assert/strict';
import test from 'node:test';
import {
  foldLayoutFromRegions,
  foldLayoutsFromRegions,
  foldLayoutsIntersectingRow,
  resolveTrailingInspectorLayout,
  resolveVerticalFoldPanePlan,
  resolveVerticalMultiFoldPanePlan,
  type FoldLayout,
} from './fold-layout.ts';
import type { ReservedRegion } from './reserved-regions.types.ts';

const margins = { top: 0, left: 0, bottom: 0, right: 0 };

test('normalizes an Android half-opened horizontal fold as tabletop posture', () => {
  const region: ReservedRegion = {
    kind: 'division',
    x: 0,
    y: 390,
    width: 800,
    height: 4,
    margins,
    active: true,
    orientation: 'horizontal',
    state: 'halfOpened',
    occlusionType: 'none',
    separating: true,
  };

  assert.deepEqual(foldLayoutFromRegions([region]), {
    orientation: 'horizontal',
    state: 'halfOpened',
    posture: 'tabletop',
    occlusionType: 'none',
    separating: true,
    x: 0,
    y: 390,
    width: 800,
    height: 4,
  });
});

test('keeps a flat dual-screen hinge separating and converts window x to pane-row local x', () => {
  const region: ReservedRegion = {
    kind: 'division',
    x: 430,
    y: 0,
    width: 24,
    height: 900,
    margins,
    active: true,
    orientation: 'vertical',
    state: 'flat',
    occlusionType: 'full',
    separating: true,
  };

  // The row starts 80dp into the window (for example beside a rail).
  // A window-space hinge at x=430 must therefore land at local x=350.
  const fold = foldLayoutFromRegions([region], 80);
  assert.equal(fold?.x, 350);
  assert.equal(fold?.separating, true);
  assert.equal(fold?.posture, 'flat');
});

test('preserves negative local x for a hinge left of an offset pane row', () => {
  const region: ReservedRegion = {
    kind: 'division',
    x: 20,
    y: 0,
    width: 24,
    height: 900,
    margins,
    active: true,
    orientation: 'vertical',
    state: 'flat',
    occlusionType: 'full',
    separating: true,
  };

  const fold = foldLayoutFromRegions([region], 80);
  assert.equal(fold?.x, -60);
});

test('infers orientation for UIKit division regions without Android metadata', () => {
  const region: ReservedRegion = {
    kind: 'division',
    x: 430,
    y: 0,
    width: 6,
    height: 900,
    margins,
    active: true,
  };

  assert.equal(foldLayoutFromRegions([region])?.orientation, 'vertical');
});

const verticalFold: FoldLayout = {
  orientation: 'vertical',
  state: 'flat',
  posture: 'flat',
  occlusionType: 'full',
  separating: true,
  x: 430,
  y: 0,
  width: 20,
  height: 900,
};

test('uses the hinge as supplementary/detail boundary when both leading panes fit', () => {
  const plan = resolveVerticalFoldPanePlan({
    fold: verticalFold,
    rowWidth: 880,
    primaryVisible: true,
    supplementaryVisible: true,
    detailVisible: true,
    primaryWidth: 200,
    supplementaryWidth: 294,
    detailMinWidth: 264,
    paneMinWidth: 160,
  });

  assert.deepEqual(plan, {
    splitAfter: 'supplementary',
    primaryWidth: 200,
    supplementaryWidth: 230,
    gapWidth: 20,
  });
});

test('uses the hinge as primary boundary when two leading panes cannot fit on the first region', () => {
  const plan = resolveVerticalFoldPanePlan({
    fold: verticalFold,
    rowWidth: 880,
    primaryVisible: true,
    supplementaryVisible: true,
    detailVisible: true,
    primaryWidth: 340,
    supplementaryWidth: 294,
    detailMinWidth: 264,
    paneMinWidth: 160,
  });

  assert.deepEqual(plan, {
    splitAfter: 'primary',
    primaryWidth: 430,
    supplementaryWidth: 166,
    gapWidth: 20,
  });
});

test('does not rearrange a flat continuous non-separating fold', () => {
  const plan = resolveVerticalFoldPanePlan({
    fold: { ...verticalFold, separating: false, occlusionType: 'none' },
    rowWidth: 880,
    primaryVisible: true,
    supplementaryVisible: false,
    detailVisible: true,
    primaryWidth: 320,
    supplementaryWidth: 294,
    detailMinWidth: 264,
    paneMinWidth: 160,
  });

  assert.equal(plan, null);
});


test('inspector overlays from the trailing physical region without crossing hinge', () => {
  assert.deepEqual(
    resolveTrailingInspectorLayout({
      folds: [verticalFold],
      rowWidth: 880,
      preferredWidth: 280,
      isRTL: false,
    }),
    {
      width: 280,
      edge: 'right',
      closedX: 300,
    },
  );
});

test('inspector ignores a separating hinge that is completely outside the pane row', () => {
  assert.deepEqual(
    resolveTrailingInspectorLayout({
      folds: [{ ...verticalFold, x: -120, width: 20 }],
      rowWidth: 600,
      preferredWidth: 280,
      isRTL: true,
    }),
    {
      width: 280,
      edge: 'left',
      closedX: -300,
    },
  );
});

test('inspector width is capped when the trailing fold region is narrower', () => {
  assert.deepEqual(
    resolveTrailingInspectorLayout({
      folds: [{ ...verticalFold, x: 650, width: 30 }],
      rowWidth: 880,
      preferredWidth: 280,
      isRTL: false,
    }),
    {
      width: 200,
      edge: 'right',
      closedX: 220,
    },
  );
});

test('RTL inspector uses the logical trailing edge and stays left of the hinge', () => {
  assert.deepEqual(
    resolveTrailingInspectorLayout({
      folds: [verticalFold],
      rowWidth: 880,
      preferredWidth: 280,
      isRTL: true,
    }),
    {
      width: 280,
      edge: 'left',
      closedX: -300,
    },
  );
});


test('preserves and sorts multiple vertical hinges for trifold-aware consumers', () => {
  const right: ReservedRegion = {
    kind: 'division',
    x: 700,
    y: 0,
    width: 12,
    height: 900,
    margins,
    active: true,
    orientation: 'vertical',
    state: 'flat',
    occlusionType: 'full',
    separating: true,
  };
  const left: ReservedRegion = { ...right, x: 350 };

  const folds = foldLayoutsFromRegions([right, left]);
  assert.equal(folds.length, 2);
  assert.equal(folds[0]?.x, 350);
  assert.equal(folds[1]?.x, 700);
});


test('filters off-row folds before primary hinge selection', () => {
  const offRow: FoldLayout = { ...verticalFold, x: -100, width: 20 };
  const inRow: FoldLayout = { ...verticalFold, x: 300, width: 20 };

  assert.deepEqual(
    foldLayoutsIntersectingRow([offRow, inRow], 600).map((fold) => fold.x),
    [300],
  );
});

test('keeps an in-row zero-width separating crease', () => {
  const crease: FoldLayout = { ...verticalFold, x: 300, width: 0 };

  assert.deepEqual(foldLayoutsIntersectingRow([crease], 600), [crease]);
});

test('maps three panes one-per-region across two separating vertical hinges', () => {
  const first: FoldLayout = { ...verticalFold, x: 320, width: 16 };
  const second: FoldLayout = { ...verticalFold, x: 660, width: 20 };

  assert.deepEqual(
    resolveVerticalMultiFoldPanePlan({
      folds: [second, first],
      rowWidth: 1000,
      primaryVisible: true,
      supplementaryVisible: true,
      detailVisible: true,
      primaryWidth: 300,
      supplementaryWidth: 300,
      detailMinWidth: 220,
      paneMinWidth: 160,
    }),
    {
      primaryWidth: 320,
      supplementaryWidth: 324,
      gapAfterPrimary: 16,
      gapAfterSupplementary: 20,
    },
  );
});

test('multi-hinge planner declines when the authored shape has fewer than three panes', () => {
  const first: FoldLayout = { ...verticalFold, x: 320, width: 16 };
  const second: FoldLayout = { ...verticalFold, x: 660, width: 20 };

  assert.equal(
    resolveVerticalMultiFoldPanePlan({
      folds: [first, second],
      rowWidth: 1000,
      primaryVisible: true,
      supplementaryVisible: false,
      detailVisible: true,
      primaryWidth: 300,
      supplementaryWidth: 300,
      detailMinWidth: 220,
      paneMinWidth: 160,
    }),
    null,
  );
});

test('inspector stays inside the trailingmost physical region on a trifold', () => {
  const first: FoldLayout = { ...verticalFold, x: 300, width: 20 };
  const second: FoldLayout = { ...verticalFold, x: 700, width: 20 };

  assert.deepEqual(
    resolveTrailingInspectorLayout({
      folds: [first, second],
      rowWidth: 880,
      preferredWidth: 280,
      isRTL: false,
    }),
    {
      width: 160,
      edge: 'right',
      closedX: 180,
    },
  );
});
