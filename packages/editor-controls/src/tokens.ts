/** Design tokens for the editor controls.
 *
 * Two parts:
 *
 * - `tokens` mirrors values from `packages/studio-workspace/src/tokens.ts`
 *   (which reads `workspaceScale` in `theme.ts`). Every key here has the same
 *   group, name and value as there. This package cannot import studio-workspace
 *   (studio-workspace depends on editor-controls), so it keeps a copy, and
 *   `tooling/check-token-mirror.mjs` fails if any mirrored value differs.
 *   `spacing.fixed*` are the standard-density steps of `workspaceScale.space`
 *   and `workspaceScale.size`; `spacing.off*` and `text.off*` are the off-scale
 *   steps studio-workspace already names.
 * - `controlTokens` holds the few roles the workspace has no token for, named by
 *   role. Each is listed, with why it exists, in
 *   docs/design/editor-controls-tokens-2026-11-28.md.
 *
 * Radius stays in `radius.ts` (mirror of `forgeRadius`). Colours come from the
 * NYC-Tron theme classes (`bg-accent`, `border-border` ...) or from the
 * scheme-independent workspace tokens mirrored here. */
export const tokens = {
  spacing: {
    fixedStack: 4,
    fixedElement: 8,
    fixedInset: 12,
    fixedGroup: 16,
    fixedSection: 24,
    fixedCanvas: 32,
    fixedPage: 64,
    fixedTarget: 44,
    fixedRail: 72,
    fixedHeader: 60,
    fixedToolbar: 52,
    fixedStatus: 28,
    off1_5: 1.5, off2: 2, off3: 3, off5: 5, off5_75: 5.75, off6: 6, off7: 7, off10: 10, off14: 14,
    off18: 18, off20: 20, off22: 22, off25: 25, off26: 26, off28: 28, off33: 33,
    off40: 40, off48: 48, off50: 50, off76: 76, off84: 84, off96: 96, off104: 104, off360: 360,
    off480: 480, off520: 520, off600: 600, off680: 680, off760: 760, off792: 792, off800: 800, off1200: 1200,
  },
  text: {
    micro: 10, label: 12, body: 14, title: 20, display: 32,
    off9: 9, off11: 11, off13: 13, off15: 15, off22: 22, off28: 28,
  },
  leading: { off18: 18, off19: 19 },
  borderWidth: { hairline: 1, strong: 2, off1_5: 1.5, off3: 3 },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  opacity: { disabled: 0.52, scrim: 0.45 },
  size: { iconXs: 12, iconSm: 16, iconToolbar: 20, iconDefault: 24, iconTouch: 28, iconFeature: 32, iconHero: 48 },
  shadow: { floatSm: '0 3px 12px #00000020', floatMd: '0 4px 16px #00000030' },
  color: { scrim: '#000000' },
} as const;

/** Roles with no workspace token. Named by role; values chosen as described in the doc. */
export const controlTokens = {
  /** Stacking order inside one control. Never compared with `tokens.z` (workspace chrome layers). */
  layer: { resting: 1, lifted: 2, guide: 3, ghost: 4, indicator: 5, handle: 6, floating: 10 },
  /** Emphasis of decorative marks (grid lines, guides, mattes). Disabled state is `tokens.opacity.disabled`. */
  opacity: { faint: 0.35, muted: 0.6, strong: 0.9 },
  /** Text inputs keep 16 px so mobile Safari does not zoom the page on focus. */
  type: { input: 16 },
  /** Line height as a multiple of the font size, for text drawn at a computed size (slide thumbnails). */
  leadingRatio: { thumbnail: 1.2 },
  /** Fixed extents of control parts that have no spacing step: value fields, columns, preview panes and list viewports. */
  extent: {
    field: 88,
    fieldWide: 120,
    column: 160,
    previewCompact: 180,
    preview: 240,
    list: 320,
    listTall: 400,
  },
} as const;
