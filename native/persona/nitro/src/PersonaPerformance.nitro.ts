import { Apple, Android, type HybridObject } from 'nitro-core';
export * from '#nitro/PersonaPerformance';

/** Bounded native performance timeline. Native renderers sample the C++ core.
 * The JS sample method is for inspection, not per-frame animation. All controls
 * use the source schema selected by a separately calibrated GNM mapping. */
@Apple({language: 'c++', implementation: {include: '<NitroForgePersona/HybridPersonaPerformance.hpp>', className: 'HybridPersonaPerformance'}})
@Android({language: 'c++', implementation: {include: '<NitroForgePersona/HybridPersonaPerformance.hpp>', className: 'HybridPersonaPerformance'}})
export declare class PersonaPerformance extends HybridObject {
  constructor(sourceCount: number, targetCount: number, matrix: number[], bias: number[], minimum: number[], maximum: number[], capacity: number, maximumGapSeconds: number);
  append(seconds: number, weights: number[]): void;
  sample(seconds: number): number[];
  reset(): void;
  close(): void;
}
