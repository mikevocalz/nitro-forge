/**
 * Compile-time contract between Cadence's bindings and the released
 * @nyc-tron/ui InstrumentKnob props (tooling/nyc-tron.json pin). `pnpm
 * typecheck` fails if either side drifts. The native ArcKnob contract is
 * checked by examples/native-cadence, which installs @nyc-tron/native-controls.
 */
import type { InstrumentKnobProps } from "@nyc-tron/ui/components/forge/inputs/InstrumentKnob";
import type { PrecisionScrubberProps } from "@nyc-tron/ui/components/forge/inputs/PrecisionScrubber";
import type { CadenceKnobBinding } from "../src/instrument-adapter";
import type { MixingConsoleProps } from "@nyc-tron/ui/components/forge/audio/MixingConsole";
import type { LevelFaderProps } from "@nyc-tron/ui/components/forge/audio/LevelFader";
import type { TempoAndMetronomeProps } from "@nyc-tron/ui/components/forge/audio/TempoAndMetronome";
import type { MIDIPianoRollProps } from "@nyc-tron/ui/components/forge/midi/MIDIPianoRoll";
import type { MIDIVelocityLaneProps } from "@nyc-tron/ui/components/forge/midi/MIDIVelocityLane";
import type { StepSequencerProps } from "@nyc-tron/ui/components/forge/midi/StepSequencer";
import type {
  CadenceClipBindings, CadenceMidiNote, CadenceMixerBindings, CadenceMixerChannel, CadenceTempoBindings,
} from "../src/editor-adapter";
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

// TempoAndMetronome renders PrecisionScrubber for BPM; the tempo range and
// commit must fit its props too.
type ScrubberContract = Pick<PrecisionScrubberProps, "min" | "max" | "step" | "onCommit">;
export const tempoFeedsPrecisionScrubber = (t: CadenceTempoBindings): ScrubberContract =>
  ({ min: t.min, max: t.max, step: t.step, onCommit: t.onTempoCommit });
export const precisionScrubberPropsAreTyped: IsAny<PrecisionScrubberProps> extends false ? true : never = true;

// Mixer and MIDI editors (NYC-Tron-UI #41, released in v0.1.0-alpha.3): every
// Cadence binding must be assignable to the released props it is spread into.
export const mixerFeedsMixingConsole = (
  m: CadenceMixerBindings, channels: readonly CadenceMixerChannel[],
): Pick<MixingConsoleProps, "channels" | "onGainCommit" | "onPanCommit" | "onMutedCommit" | "onSoloCommit"> =>
  ({ channels, ...m });
// A single channel's gain drives a standalone LevelFader: the engine's linear
// 0..1 volume is LevelFader's linear gain, and one commit is one engine write.
export const channelFeedsLevelFader = (
  m: CadenceMixerBindings, channel: CadenceMixerChannel,
): Pick<LevelFaderProps, "value" | "label" | "onCommit"> =>
  ({ value: channel.gain, label: channel.name, onCommit: (gain) => m.onGainCommit(channel.id, gain) });
export const levelFaderPropsAreTyped: IsAny<LevelFaderProps> extends false ? true : never = true;
export const tempoFeedsTempoAndMetronome = (
  t: CadenceTempoBindings,
): Pick<TempoAndMetronomeProps, "onTempoCommit" | "onTimeSignatureCommit"> => t;
export const clipFeedsPianoRoll = (
  c: CadenceClipBindings, notes: readonly CadenceMidiNote[],
): Pick<MIDIPianoRollProps, "notes" | "onNoteMove" | "onNoteResize" | "onNoteAdd" | "onNoteRemove"> =>
  ({ notes, ...c });
export const clipFeedsVelocityLane = (
  c: CadenceClipBindings, notes: readonly CadenceMidiNote[],
): Pick<MIDIVelocityLaneProps, "notes" | "onVelocityCommit"> => ({ notes, onVelocityCommit: c.onVelocityCommit });
export const clipFeedsStepSequencer = (
  c: CadenceClipBindings, notes: readonly CadenceMidiNote[],
): Pick<StepSequencerProps, "notes" | "onStepAdd" | "onStepRemove" | "onStepVelocity"> => ({ notes, ...c });
export const mixingConsolePropsAreTyped: IsAny<MixingConsoleProps> extends false ? true : never = true;
export const pianoRollPropsAreTyped: IsAny<MIDIPianoRollProps> extends false ? true : never = true;
