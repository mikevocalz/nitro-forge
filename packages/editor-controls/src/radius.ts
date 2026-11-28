/** Forge's two view radii and its hairline radii, for the editor controls.
 *
 * The definition lives in `packages/studio-workspace/src/theme.ts`, which this
 * package cannot import (studio-workspace depends on editor-controls). This is a
 * mirror of it: `tooling/check-radius.mjs` fails if the two differ.
 *
 * `md` (6 px) is for outer views, `sm` (4 px) for inner views and controls.
 * Hairline radii, all under 4 px, are for ticks, needles, meter segments and
 * the strokes of glyphs drawn with views. See design/DIRECTION.md, "Owner brief
 * and view radius rule". */
export const forgeRadius = { sm: 4, md: 6 } as const;
/** Sub-4 px radii for hairline details only (ticks, needles, meter segments). */
export const forgeHairlineRadius = { tick: 1, needle: 0.75 } as const;
