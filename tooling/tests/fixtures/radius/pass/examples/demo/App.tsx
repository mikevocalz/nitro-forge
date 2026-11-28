import { forgeRadius } from '../../packages/studio-workspace/src/theme.ts';
export const card = { borderRadius: forgeRadius.md };
export const pick = (on: boolean) => ({ borderRadius: on ? forgeRadius.sm : 0 });
