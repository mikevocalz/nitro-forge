import {forgeRadius} from "../radius.ts";
import {assertMidiNotes} from './note-grid.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { Pressable, ScrollView, Text, View, type KeyDownEvent, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { webToggleProps } from "@nyc-tron/ui/components/forms/toggle-a11y";
import { stepCells, type MidiNote, type StepLane } from "./note-grid.ts";
import {exact} from '../exact-optional.ts';

const HIT = 44;
const NAME_COLUMN = 72;

/** Props for {@linkcode StepSequencer}. */
export interface StepSequencerProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Committed notes of the clip the grid edits. */
  readonly notes: readonly MidiNote[];
  /** One row per instrument, top to bottom. */
  readonly lanes: readonly StepLane[];
  /** Clip length, ticks. `steps * stepTicks` must fit. */
  readonly clipTicks: number;
  /** @default 16 */
  readonly steps?: number;
  /** Ticks per step. @default 240 (a sixteenth at 960 ppq) */
  readonly stepTicks?: number;
  /** Steps per beat group, for shading. @default 4 */
  readonly stepsPerBeat?: number;
  /** Velocity of a new step. @default 96 */
  readonly velocity?: number;
  /** Velocity of an accented step; a step at or above it shows as accented. @default 127 */
  readonly accentVelocity?: number;
  /** Step under the playhead while playing. */
  readonly currentStep?: number;
  /** Turn an empty step on. */
  readonly onStepAdd: (pitch: number, startTicks: number, lengthTicks: number, velocity: number) => void | Promise<unknown>;
  /** Turn a step off. `noteIndex` is the engine's note index. */
  readonly onStepRemove: (noteIndex: number) => void | Promise<unknown>;
  /** Accent or un-accent a step (long press, the A key, or the screen-reader action). */
  readonly onStepVelocity: (noteIndex: number, velocity: number) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  /** @default "Step sequencer" */
  readonly label?: string;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled beat grid over one clip's notes. A step is a note of the
 * lane's pitch starting on that step. Press toggles a step, long press or A
 * toggles its accent. Each press is one commit.
 *
 * Steps run left to right in every locale, like the piano roll. Lanes are
 * pitches, so a drum map is the app's `lanes` list.
 */
export function StepSequencer({scope='StepSequencer',revision=0,...props}:StepSequencerProps){
 assertMidiNotes(props.notes,props.clipTicks);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.clipTicks,props.steps,props.stepTicks,props.lanes,props.notes,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <StepSequencerBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onStepAdd={(...args:Parameters<StepSequencerProps['onStepAdd']>)=>guard.run('onStepAdd',h=>h.onStepAdd(...args))}
  onStepRemove={(...args:Parameters<StepSequencerProps['onStepRemove']>)=>guard.run('onStepRemove',h=>h.onStepRemove(...args))}
  onStepVelocity={(...args:Parameters<StepSequencerProps['onStepVelocity']>)=>guard.run('onStepVelocity',h=>h.onStepVelocity(...args))}
 />;
}
function StepSequencerBody({actionError,disabledReason,
  notes, lanes, clipTicks, steps = 16, stepTicks = 240, stepsPerBeat = 4, velocity = 96, accentVelocity = 127,
  currentStep, onStepAdd, onStepRemove, onStepVelocity, disabled = false, label = "Step sequencer",
  className, unstyled = false, ...rest
}: StepSequencerProps&{actionError?:string|null}) {
  if (!Number.isInteger(clipTicks) || steps * stepTicks > clipTicks) {
    throw new RangeError("steps * stepTicks must fit inside clipTicks");
  }
  if (!(velocity < accentVelocity)) throw new RangeError("velocity must be below accentVelocity");
  const styled = !unstyled;
  const cells = stepCells(notes, lanes, steps, stepTicks, accentVelocity);
  const toggleAccent = (noteIndex: number, accent: boolean) => {
    if (!disabled) void onStepVelocity(noteIndex, accent ? velocity : accentVelocity);
  };
  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised", className) }}>
    <View style={{ flexDirection: "row", direction: "ltr" }}>
      <View style={{ width: NAME_COLUMN, paddingTop: 4, gap: 4 }}>
        {lanes.map(lane => <View key={lane.pitch} style={{ height: HIT, justifyContent: "center", paddingHorizontal: 8 }}>
          <Text numberOfLines={1} {...{ className: joinClasses(styled && "text-text font-semibold") }}>{lane.name}</Text>
        </View>)}
      </View>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ padding: 4, gap: 4 }}>
        <View style={{ gap: 4 }}>
          {lanes.map((lane, li) => <View key={lane.pitch} style={{ flexDirection: "row", gap: 4 }}>
            {cells[li]!.map((cell, s) => {
              const startTicks = s * stepTicks;
              const playing = s === currentStep;
              const groupShade = Math.floor(s / stepsPerBeat) % 2 === 1;
              const name = `${lane.name}, step ${s + 1}`;
              const cls = joinClasses(styled && "rounded-control items-center justify-center border-2 focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
                styled && (cell.on
                  ? (cell.accent ? "bg-primary border-primary" : "bg-accent border-accent")
                  : playing ? "bg-surface-raised border-text-muted" : (groupShade ? "bg-surface-sunken border-border" : "bg-surface-raised border-border")));
              const onKeyDown = (e: KeyDownEvent) => {
                if (!cell.on || (e.nativeEvent.key !== "a" && e.nativeEvent.key !== "A")) return;
                e.preventDefault();
                toggleAccent(cell.noteIndex, cell.accent);
              };
              return <Pressable key={s} accessibilityRole="togglebutton" accessibilityLabel={name}
                accessibilityState={{ checked: cell.on, disabled }} {...webToggleProps(cell.on)}
                accessibilityValue={cell.on && cell.accent ? { text: "accented" } : undefined}
                accessibilityActions={cell.on ? [{ name: "accent", label: cell.accent ? "Remove accent" : "Accent" }] : undefined}
                onAccessibilityAction={cell.on ? e => { if (e.nativeEvent.actionName === "accent") toggleAccent(cell.noteIndex, cell.accent); } : undefined}
                disabled={disabled}
                onPress={() => {
                  if (cell.on) void onStepRemove(cell.noteIndex);
                  else void onStepAdd(lane.pitch, startTicks, stepTicks, velocity);
                }}
                onLongPress={cell.on ? () => toggleAccent(cell.noteIndex, cell.accent) : undefined}
                onKeyDown={onKeyDown}
                {...{ className: cls }}
                style={{ width: HIT, height: HIT, opacity: disabled ? 0.45 : 1 }}>
                {cell.on && cell.accent
                  ? <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-on-primary") }}
                      style={{ width: 10, height: 10, borderRadius: forgeRadius.sm }} />
                  : null}
              </Pressable>;
            })}
          </View>)}
        </View>
      </ScrollView>
    </View>
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
