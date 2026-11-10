import { Apple, Android, type HybridObject } from 'nitro-core';
export * from '#nitro/PersonaCapture';

/**
 * Native guided-capture lifecycle (prepare/capture/handoff/processing/review/
 * save) backed by the C++ CaptureSession in native/persona. The host supplies
 * real camera frames, quality verdicts and generated assets; this object owns
 * ordering, epochs, gates and stage transitions only.
 *
 * Stage/source/gate names are stable strings so JS never depends on enum
 * ordinals. Epochs and job ids are returned as numbers.
 */
@Apple({language: 'c++', implementation: {include: '<NitroForgePersona/HybridPersonaCapture.hpp>', className: 'HybridPersonaCapture'}})
@Android({language: 'c++', implementation: {include: '<NitroForgePersona/HybridPersonaCapture.hpp>', className: 'HybridPersonaCapture'}})
export declare class PersonaCapture extends HybridObject {
  /** steps/skippable are parallel arrays; source is local_device,
   *  companion_phone or supplied_media. */
  constructor(steps: string[], skippable: boolean[], source: string);
  stage(): string;
  source(): string;
  /** Returns the capture epoch, or throws when permission is missing. */
  start(permissionGranted: boolean): number;
  /** Structured quality variant: gateNames/gatePassed are parallel arrays.
   *  Every measured gate must pass; at least one gate is required. */
  observe(epoch: number, step: string, sample: string, gateNames: string[], gatePassed: boolean[]): boolean;
  /** Boolean convenience: a single face_coverage gate. */
  observeSimple(epoch: number, step: string, sample: string, qualityAccepted: boolean): boolean;
  skip(epoch: number, step: string): boolean;
  /** Seals coverage. Phone sources return a handoff epoch instead of a job. */
  generate(): number;
  /** Companion-phone only: acknowledges transfer, returns the job epoch. */
  transferAcknowledged(): number;
  generated(job: number, asset: string, qualityAccepted: boolean): boolean;
  generationFailed(job: number): boolean;
  save(): void;
  cancel(): void;
  forget(): void;
  savedAsset(): string;
  previewAsset(): string;
  observationCount(): number;
  appearanceWarmth(): number;
  appearanceBrightness(): number;
  appearanceTouchUp(): boolean;
  appearanceBackgroundFill(): string;
  setAppearance(warmth: number, brightness: number, touchUp: boolean, backgroundFill: string): void;
  hasRejection(): boolean;
  rejectionStep(): string;
  rejectionGate(): string;
}
