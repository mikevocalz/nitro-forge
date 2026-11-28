/**
 * MIDI channel stepper and the small integer stepper it is built on.
 *
 * Structural references (Mobbin, iOS; structure only):
 * - Cal AI, Edit Ingredient: a unit chooser beside a compact value field.
 * - Riveo, clip audio sheet: label, value and a 44 pt row per numeric setting.
 * - TikTok, Set countdown: a two-option segmented control inline with its label.
 * - Spotify, Edit transition: per-lane curve editing with preset buttons under it.
 *
 * Both controls are controlled: the value is the committed engine state, and
 * each press or key commits once.
 */
import { Pressable, Text, View, type KeyDownEvent, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { MAX_MIDI_CHANNEL, channelLabel, isMidiChannel } from "./note-grid.ts";
import type { MIDIPianoRollProps } from "./MIDIPianoRoll.tsx";
import { tokens } from "../tokens.ts";

const HIT = 44;

/** Props for {@linkcode MidiValueStepper}. */
export interface MidiValueStepperProps extends Omit<ViewProps, "children"> {
  /** Committed value, an integer in `min..max`. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Accessible name of the whole stepper, e.g. `"Ramp end velocity"`. */
  readonly label: string;
  /** Visible text for the value. @default String(value) */
  readonly format?: (value: number) => string;
  /** Spoken value, e.g. `"Channel 3"`. @default format(value) */
  readonly valueText?: (value: number) => string;
  /** Step for the buttons, arrows and screen-reader actions. @default 1 */
  readonly step?: number;
  /** Step for PageUp/PageDown. @default 10 * step */
  readonly pageStep?: number;
  /**
   * Once per button press, key or screen-reader action, with the clamped
   * new value. Never called with an unchanged value.
   */
  readonly onValueCommit: (value: number) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled integer stepper: a value between − and + buttons (44 pt each).
 * It is one `slider` for assistive technology, with increment/decrement
 * actions, and takes Up/Right to raise, Down/Left to lower, PageUp/PageDown,
 * Home and End when focused.
 *
 * Right raises in every locale: the buttons mirror in right-to-left layouts
 * (− stays on the leading side) but the keys are physical.
 *
 * @see {@linkcode MidiChannelPicker} for the MIDI channel preset.
 */
export function MidiValueStepper({
  value, min, max, label, format = String, valueText, step = 1, pageStep, onValueCommit, disabled = false,
  className, unstyled = false, style, ...rest
}: MidiValueStepperProps) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new RangeError("Stepper needs integer min <= max");
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Stepper value must be an integer ${min}..${max}`);
  const styled = !unstyled;
  const page = pageStep ?? step * 10;
  const go = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (disabled || clamped === value) return;
    void onValueCommit(clamped);
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    const next = key === "ArrowUp" || key === "ArrowRight" ? value + step
      : key === "ArrowDown" || key === "ArrowLeft" ? value - step
      : key === "PageUp" ? value + page : key === "PageDown" ? value - page
      : key === "Home" ? min : key === "End" ? max : undefined;
    if (next === undefined) return;
    e.preventDefault();
    go(next);
  };
  const button = (on: boolean) => joinClasses(styled && "rounded-control items-center justify-center border border-border bg-surface-sunken active:opacity-80",
    styled && !on && "opacity-40");
  const text = joinClasses(styled && "text-text font-semibold");
  const spoken = (valueText ?? format)(value);
  return <View {...rest} accessible focusable={!disabled} accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityValue={{ min, max, now: value, text: spoken }}
    {...{ "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": value, "aria-valuetext": spoken }}
    accessibilityState={{ disabled }}
    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
    onAccessibilityAction={e => go(value + (e.nativeEvent.actionName === "increment" ? step : -step))}
    onKeyDown={onKeyDown}
    {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus", className) }}
    style={[{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.fixedStack, opacity: disabled ? tokens.opacity.disabled : 1 }, style]}>
    {/* The buttons are pointer targets; keyboard and screen readers use the slider itself. */}
    <Pressable accessible={false} focusable={false} disabled={disabled || value <= min} onPress={() => go(value - step)}
      {...{ className: button(value > min), "aria-hidden": true, tabIndex: -1 }} style={{ width: HIT, height: HIT }}>
      <Text {...{ className: text }}>−</Text>
    </Pressable>
    <Text {...{ className: text }} style={{ minWidth: tokens.spacing.fixedCanvas, textAlign: "center", fontVariant: ["tabular-nums"] }}>{format(value)}</Text>
    <Pressable accessible={false} focusable={false} disabled={disabled || value >= max} onPress={() => go(value + step)}
      {...{ className: button(value < max), "aria-hidden": true, tabIndex: -1 }} style={{ width: HIT, height: HIT }}>
      <Text {...{ className: text }}>+</Text>
    </Pressable>
  </View>;
}

/** Props for {@linkcode MidiChannelPicker}. */
export interface MidiChannelPickerProps extends Omit<ViewProps, "children"> {
  /** Committed channel, 0..15. Shown and spoken as 1..16. */
  readonly channel: number;
  /** Once per press or key, with the new zero-based channel. */
  readonly onChannelCommit: (channel: number) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  /** Accessible name. @default "MIDI channel" */
  readonly label?: string;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled MIDI channel stepper for one note or clip: a visible "Ch" label,
 * the one-based channel and −/+ buttons. Screen readers hear a slider named
 * "MIDI channel" with the value "Channel 3". The value stays zero-based in
 * props and commits, like the Cadence `setNoteChannel` op.
 *
 * @see {@linkcode MIDIPianoRollProps.onNoteChannel} which renders this for the selected note.
 */
export function MidiChannelPicker({
  channel, onChannelCommit, disabled = false, label = "MIDI channel", className, unstyled = false, style, ...rest
}: MidiChannelPickerProps) {
  if (!isMidiChannel(channel)) throw new RangeError("MIDI channel must be 0..15");
  return <View {...rest} style={[{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.off6 }, style]}
    {...{ className: joinClasses(className) }}>
    <Text aria-hidden {...{ className: joinClasses(!unstyled && "text-text-muted") }}>Ch</Text>
    <MidiValueStepper value={channel} min={0} max={MAX_MIDI_CHANNEL} label={label} pageStep={4}
      format={c => String(c + 1)} valueText={channelLabel} onValueCommit={onChannelCommit}
      disabled={disabled} unstyled={unstyled} />
  </View>;
}
