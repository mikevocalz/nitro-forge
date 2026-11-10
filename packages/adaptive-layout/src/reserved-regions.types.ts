// Physical regions inside the current application window.
//
// iOS 27.1 contributes UIKit reserved regions (division / occlusion).
// Android contributes Jetpack WindowManager FoldingFeatures normalized as
// division, plus the native posture metadata WindowManager actually exposes.
//
// The geometry is always in React Native layout units: points on iOS and dp on
// Android. Do not introduce PixelRatio conversions in consumers.
//
// IMPORTANT: Android WindowManager does NOT expose a continuous hinge angle.
// state, orientation, occlusionType and separating are the supported signals;
// code must not infer an angle from them.
//
// SOT: apps/mobile/modules/reserved-regions
// SOT-KEYWORDS: reserved regions folding feature hinge posture division occlusion android iphone duo
export type FoldOrientation = 'vertical' | 'horizontal';
export type FoldState = 'flat' | 'halfOpened';
export type FoldOcclusionType = 'none' | 'full';

export interface ReservedRegion {
  kind: 'division' | 'occlusion';
  x: number;
  y: number;
  width: number;
  height: number;
  margins: { top: number; left: number; bottom: number; right: number };
  active: boolean;

  /** Android FoldingFeature orientation. Absent on UIKit-only regions. */
  orientation?: FoldOrientation;
  /** Android FoldingFeature state. Absent on UIKit-only regions. */
  state?: FoldState;
  /** Android FoldingFeature occlusion mode. Absent on UIKit-only regions. */
  occlusionType?: FoldOcclusionType;
  /**
   * Whether the feature makes two logical display areas. This is true for a
   * physical dual-screen hinge even while FLAT, and for HALF_OPENED folds.
   */
  separating?: boolean;
}
