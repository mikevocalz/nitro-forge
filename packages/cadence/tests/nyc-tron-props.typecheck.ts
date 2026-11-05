/**
 * Compile-time contract between Cadence's bindings and the released
 * @nyc-tron/ui InstrumentKnob props (tooling/nyc-tron.json pin). `pnpm
 * typecheck` fails if either side drifts. The native ArcKnob contract is
 * checked by examples/native-cadence, which installs @nyc-tron/native-controls.
 */
import type { InstrumentKnobProps } from "@nyc-tron/ui/components/forge/inputs/InstrumentKnob";
import type { CadenceKnobBinding } from "../src/instrument-adapter";
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
