import {audioTargetSize} from './audio-chrome.ts';
import { Text, View, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { LevelFader, type LevelFaderProps } from "./LevelFader.tsx";
import { LevelMeter } from "./LevelMeter.tsx";
import { PanControl, type PanControlProps } from "./PanControl.tsx";
import { SoloMuteButtons, type SoloMuteButtonsProps } from "./SoloMuteButtons.tsx";
import { FADER_RANGES, gainToDb, type FaderRange } from "./level.ts";
import type { MeterBand } from "./level-meter.ts";
import { describeAudibility, type Audibility, type MixerChannel } from "./mixer.ts";

/**
 * Meter values for one strip, linear sample peak as the Cadence `meter` op
 * reports it (not true peak). Run them through `createPeakHold` first for
 * fall-off and hold.
 * @see {@linkcode ChannelStripProps.meter}
 */
export interface ChannelMeter {
  /** Current bar level, linear; 1.0 is 0 dBFS. */
  readonly peak: number;
  /** Held peak marker, linear. */
  readonly hold?: number;
}

/** Props for {@linkcode ChannelStrip}. */
export interface ChannelStripProps extends Omit<ViewProps, "children"> {
  /** App-owned minimum interaction target. Defaults to 44 points. */
  readonly targetSize?: number;
  readonly labels?:{fader?:LevelFaderProps["labels"];pan?:PanControlProps["labels"];toggles?:SoloMuteButtonsProps["labels"]}|undefined;
  readonly channel: MixerChannel;
  /** From {@linkcode audibility} across the whole console. @default from `channel.muted` */
  readonly audibility?: Audibility | undefined;
  readonly onGainCommit: (gain: number) => void | Promise<unknown>;
  readonly onPanCommit: (pan: number) => void | Promise<unknown>;
  readonly onMutedCommit: (muted: boolean) => void | Promise<unknown>;
  readonly onSoloCommit: (solo: boolean) => void | Promise<unknown>;
  /** When given, the strip draws a solo-safe toggle. */
  readonly onSoloSafeCommit?: ((safe: boolean) => void | Promise<unknown>) | undefined;
  /** Live previews; never persist these. */
  readonly onGainChange?: ((gain: number) => void) | undefined;
  readonly onPanChange?: ((pan: number) => void) | undefined;
  /**
   * Level meter beside the fader. Omit it and no meter is drawn; the strip
   * never shows a placeholder level.
   */
  readonly meter?: ChannelMeter | undefined;
  /**
   * Name of the bus `channel.output` points at, shown as `"to <name>"`.
   * {@linkcode MixingConsole} resolves it from the channel list.
   */
  readonly outputName?: string | undefined;
  /**
   * Lines of routing text (bus tag, group, output) to reserve above the
   * fader, so faders line up across strips with and without routing.
   * {@linkcode MixingConsole} passes the console-wide maximum. @default 0
   */
  readonly routingLines?: number;
  /**
   * Fader window. The Cadence engine stores gain 0..1, so the default tops
   * out at unity. @default FADER_RANGES.UNITY
   */
  readonly range?: FaderRange;
  /** Fader travel, points. @default 160 */
  readonly faderLength?: number;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  unstyled?: boolean;
}

/** Strip width. Fits the fader's −/+ row and the pan track at 44pt targets. */
export const CHANNEL_STRIP_WIDTH = 120;

/** Extra strip width taken by the meter column when a meter is drawn. */
export const CHANNEL_STRIP_METER_WIDTH = 34;

/** Spoken meter bands for a mixer channel (the defaults say "Input"). */
const CHANNEL_BANDS = {
  silent: "Silent",
  low: "Low",
  good: "Good",
  hot: "Hot",
  clipping: "Clipping",
} as const satisfies Record<MeterBand, string>;

/** Height of one routing line (`text-xs` line height). */
const ROUTING_LINE = 16;

/**
 * Routing lines a strip shows above its fader, top to bottom: `"Bus"` for a
 * bus, the group name, and `"to <bus>"` when routed to a bus.
 * @see {@linkcode ChannelStripProps.routingLines}
 */
export function channelRouting(
  channel: Pick<MixerChannel, "kind" | "group" | "output">, outputName?: string,
): string[] {
  const routed = channel.output !== undefined && channel.output !== null;
  return [channel.kind === "bus" ? "Bus" : undefined, channel.group,
    routed ? "to " + (outputName ?? String(channel.output)) : undefined]
    .filter((x): x is string => x !== undefined && x !== "");
}

/**
 * Held peak as a short readout that fits the meter column: `"Clip"` at or
 * over full scale, one decimal down to -10 dBFS, whole dB below that.
 */
function holdReadout(hold: number): string {
  if (hold >= 1) return "Clip";
  if (hold <= 0) return "-∞";
  const db = gainToDb(hold);
  return db > -10 ? db.toFixed(1) : String(Math.round(db));
}

/**
 * One mixer column: routing and group line, level fader with dB readout,
 * optional sample-peak meter, pan (balance on a bus), mute, solo and
 * optional solo safe. Controlled; every control commits once per gesture
 * through its callback.
 *
 * A bus strip (`channel.kind === "bus"`) sits on the sunken surface and is
 * labelled "Bus"; its pan control is a balance.
 */
export function ChannelStrip({
  channel, audibility, onGainCommit, onPanCommit, onMutedCommit, onSoloCommit, onSoloSafeCommit,
  onGainChange, onPanChange, meter, outputName, routingLines = 0,
  range = FADER_RANGES.UNITY, faderLength = 160, disabled = false, targetSize, labels, className, unstyled = false, style, ...rest
}: ChannelStripProps) {
  const target = audioTargetSize(targetSize);
  const stripWidth = CHANNEL_STRIP_WIDTH + (target - 44) * 2;
  const styled = !unstyled;
  const state: Audibility = audibility ?? (channel.muted ? "muted" : "audible");
  const bus = channel.kind === "bus";
  const width = stripWidth + (meter ? CHANNEL_STRIP_METER_WIDTH : 0);
  const hold = meter?.hold === undefined ? meter?.peak : Math.max(meter.hold, meter.peak);
  const clipped = hold !== undefined && hold >= 1;
  const small = joinClasses(styled && "text-xs text-text-muted");
  const meta = channelRouting(channel, outputName);
  const lines = Math.max(routingLines, meta.length);
  // Web reads this as the group name; native screen readers reach each control.
  return <View {...rest} {...{
    role: "group",
    "aria-label": describeAudibility(channel.name, state, channel.solo,
      { kind: channel.kind, soloSafe: channel.soloSafe, group: channel.group }),
  }}
    {...{ className: joinClasses("items-center gap-2 py-2", styled && bus && "bg-surface-sunken", className) }}
    style={[{ width }, style]}>
    {lines > 0 ? <View style={{ minHeight: lines * ROUTING_LINE, alignSelf: "stretch", paddingHorizontal: 6, justifyContent: "flex-end" }}>
      {meta.map((line, i) => <Text key={line + i} numberOfLines={1}
        {...{ className: i === 0 && bus ? joinClasses(styled && "text-xs font-semibold text-text") : small }}
        style={{ textAlign: "center", lineHeight: ROUTING_LINE }}>{line}</Text>)}
    </View> : null}
    {/* Keep numeric entry inside its strip instead of using its intrinsic input width. */}
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, width: "100%" }}>
      <LevelFader targetSize={target} labels={labels?.fader} value={channel.gain} label={channel.name} range={range} length={faderLength}
        disabled={disabled} onChange={onGainChange} onCommit={onGainCommit} unstyled={unstyled}
        style={{ width: stripWidth, minWidth: 0, flexShrink: 1 }} />
      {meter ? <View style={{ width: CHANNEL_STRIP_METER_WIDTH - 4, alignItems: "center", gap: 9, paddingTop: 12 }}>
        <Text numberOfLines={1}
          {...{ className: joinClasses(styled && "text-xs", styled && (clipped ? "font-semibold text-danger" : "text-text-muted")) }}
          style={{ fontVariant: ["tabular-nums"] }}>{holdReadout(hold ?? 0)}</Text>
        <LevelMeter level={meter.peak} peakHold={meter.hold} orientation="vertical" thickness={8}
          accessibilityLabel={channel.name + " level"} bandLabels={CHANNEL_BANDS} unstyled={unstyled}
          style={{ height: faderLength }} />
      </View> : null}
    </View>
    <PanControl targetSize={target} labels={labels?.pan} value={channel.pan} label={channel.name} mode={bus ? "balance" : "pan"} width={stripWidth - 16}
      disabled={disabled} onChange={onPanChange} onCommit={onPanCommit} unstyled={unstyled} />
    <SoloMuteButtons targetSize={target} labels={labels?.toggles} label={channel.name} muted={channel.muted} solo={channel.solo} audibility={state}
      soloSafe={channel.soloSafe ?? false} onSoloSafeCommit={onSoloSafeCommit}
      disabled={disabled} onMutedCommit={onMutedCommit} onSoloCommit={onSoloCommit} unstyled={unstyled} />
  </View>;
}
