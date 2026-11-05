import type { CadenceDocument } from "./index";

/**
 * Bind NYC-Tron rotary controls to existing Cadence Rust document ops.
 * Visual previews stay in UI; the engine remains the only committed state.
 *
 * Two control families consume these bindings:
 * - `InstrumentKnob` from `@nyc-tron/ui` (React Native views) takes
 *   {@linkcode CadenceKnobBinding} as-is: `min`, `max`, `step`, `unit`, `onCommit`.
 * - `ArcKnob` from `@nyc-tron/native-controls` (SwiftUI / Compose) takes
 *   {@linkcode CadenceNativeKnobBinding}: `minimum`, `maximum`, `step`, `onCommit`.
 *
 * The shapes are structural so Cadence builds without NYC-Tron installed.
 * tests/nyc-tron-props.typecheck.ts checks them against the released
 * `@nyc-tron/ui` declarations, and the native example's typecheck checks
 * the ArcKnob shape. NYC-Tron never imports Cadence.
 */
type TrackCommands = Pick<CadenceDocument, "setTrackGain" | "setTrackPan">;
type TrackCommandResult = Awaited<ReturnType<CadenceDocument["setTrackGain"]>>;

/** Commit one completed gesture; resolves with the engine's result or rejects. */
export type InstrumentCommit = (value: number) => Promise<TrackCommandResult>;

/** Range and commit props for `InstrumentKnob` (`@nyc-tron/ui`). */
export interface CadenceKnobBinding<R = TrackCommandResult> {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly onCommit: (value: number) => Promise<R>;
}

/**
 * Range and commit props for the native `ArcKnob` (`@nyc-tron/native-controls`).
 * @see {@linkcode toNativeKnobBinding}
 */
export interface CadenceNativeKnobBinding<R = unknown> {
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly onCommit: (value: number) => Promise<R>;
}

/** Map an `InstrumentKnob` binding onto the native `ArcKnob` prop names. */
export function toNativeKnobBinding<R>(
  binding: Pick<CadenceKnobBinding, "min" | "max" | "step">,
  onCommit: (value: number) => Promise<R>,
): CadenceNativeKnobBinding<R> {
  return { minimum: binding.min, maximum: binding.max, step: binding.step, onCommit };
}

export interface CadenceTrackInstrumentBindings {
  readonly gain: CadenceKnobBinding;
  readonly pan: CadenceKnobBinding;
}

function ensureBounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError(`Out of range Cadence instrument value (${min}..${max})`);
  return value;
}

/**
 * Usage:
 * const controls = createCadenceTrackInstrumentBindings(cadence, track.id);
 * <InstrumentKnob label="Gain" value={track.volume} {...controls.gain}/>
 *
 * Never commit an x/y dual property pair using sequential operations until
 * Cadence has an atomic batch/transaction op. One gesture => one engine command.
 */
export function createCadenceTrackInstrumentBindings(
  document: TrackCommands,
  trackId: number,
): CadenceTrackInstrumentBindings {
  if (!Number.isSafeInteger(trackId) || trackId < 1)
    throw new RangeError("Invalid Cadence track id");
  return {
    gain: {
      min: 0,
      max: 1,
      step: 0.01,
      unit: "",
      onCommit: async (value) => document.setTrackGain(trackId, ensureBounded(value, 0, 1)),
    },
    pan: {
      min: -1,
      max: 1,
      step: 0.01,
      unit: "",
      onCommit: async (value) => document.setTrackPan(trackId, ensureBounded(value, -1, 1)),
    },
  };
}
