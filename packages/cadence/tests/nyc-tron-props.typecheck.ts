/**
 * Compile-time contract between Cadence's bindings and the released
 * @nyc-tron/ui InstrumentKnob props (tooling/nyc-tron.json pin). `pnpm
 * typecheck` fails if either side drifts. The native ArcKnob contract is
 * checked by examples/native-cadence, which installs @nyc-tron/native-controls.
 */
import type { InstrumentKnobProps } from "@nyc-tron/ui/components/forge/inputs/InstrumentKnob";
import type { PrecisionScrubberProps } from "@nyc-tron/ui/components/forge/inputs/PrecisionScrubber";
import type { CadenceKnobBinding } from "../src/instrument-adapter";
import type { CadenceTempoBindings } from "../src/editor-adapter";
import type { CadenceInstrumentSession } from "../src/instrument-session";

type KnobContract = Pick<InstrumentKnobProps, "min" | "max" | "step" | "unit" | "onCommit">;

export const adapterBindingFeedsInstrumentKnob = (binding: CadenceKnobBinding): KnobContract => binding;
export const sessionKnobFeedsInstrumentKnob = (
  session: CadenceInstrumentSession,
): KnobContract => session.knobs.gain;

// Guards against the release types silently collapsing to `any`.
type IsAny<T> = 0 extends 1 & T ? true : false;
export const instrumentKnobPropsAreTyped: IsAny<InstrumentKnobProps> extends false ? true : never = true;
export const instrumentKnobMinIsNumber: IsAny<InstrumentKnobProps["min"]> extends false ? true : never = true;
// @ts-expect-error InstrumentKnob requires a numeric `min`.
export const rejectsStringRange: KnobContract = { min: "0", max: 1, step: 0.01, unit: "", onCommit: () => undefined };

// TempoAndMetronome (NYC-Tron-UI #41, unreleased) renders the released
// PrecisionScrubber for BPM; the tempo range and commit must fit its props.
type ScrubberContract = Pick<PrecisionScrubberProps, "min" | "max" | "step" | "onCommit">;
export const tempoFeedsPrecisionScrubber = (t: CadenceTempoBindings): ScrubberContract =>
  ({ min: t.min, max: t.max, step: t.step, onCommit: t.onTempoCommit });
export const precisionScrubberPropsAreTyped: IsAny<PrecisionScrubberProps> extends false ? true : never = true;
