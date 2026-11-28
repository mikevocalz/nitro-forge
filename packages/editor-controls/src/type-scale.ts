/** Forge's type ramp, for the editor controls.
 *
 * The definition is `workspaceScale.type` in
 * `packages/studio-workspace/src/theme.ts`, which this package cannot import
 * (studio-workspace depends on editor-controls). This is a mirror of it:
 * `packages/studio-workspace/src/type-scale.test.ts` fails if the two differ.
 *
 * `caption` (11 px) is the smallest size for words; `micro` is for numerals
 * that sit beside larger text. */
export const forgeType = { micro: 10, caption: 11, label: 12, body: 14, title: 20, display: 32, manuscript: 20 } as const;
