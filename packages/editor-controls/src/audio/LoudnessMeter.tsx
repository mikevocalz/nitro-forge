import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
/*
 * Structural references (Mobbin, iOS, structure only):
 * - Apple Health, Headphone Audio Levels highlights: a measured value read
 *   against a fixed limit line on the same scale.
 * - TIDE, Ambient Noise: a bar history on a fixed dB scale with labelled
 *   gridlines and the average as the headline reading.
 * - Riveo, clip volume editor: compact label + value rows for audio settings.
 * - Suno, Extend: waveform card with time readouts at its edges.
 */
import { useRef } from "react";
import { Pressable, Text, View, type ViewProps } from "react-native";
import { Button } from "@nyc-tron/ui/components/Button";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { useStatusAnnouncement } from "@nyc-tron/ui/components/feedback/announce";
import {
  DEFAULT_LOUDNESS_TARGET, LOUDNESS_TARGETS, PEAK_WARNINGS, barCountForWidth, describeLoudness,
  formatDbfs, formatLufs, formatSeconds, formatSigned, historySeconds, lufsToFraction, momentaryBars,
  peakSeverity, targetDelta, type LoudnessTarget,
} from "./loudness.ts";

/** Measurement state of a {@linkcode LoudnessMeter}. */
export type LoudnessStatus = "measuring" | "ready" | "error" | "silent";

/** Props for {@linkcode LoudnessMeter}. Values come from the engine's `loudness` op. */
export interface LoudnessMeterProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Name of the measured range, for example "Master, bars 1-17". Used as the group label. */
  readonly label: string;
  /** What to draw: a placeholder, the readings, an error or the silent message. */
  readonly status: LoudnessStatus;
  /** Gated integrated loudness, LUFS. `null` when silent or shorter than one block. */
  readonly rmsDbfs?:number|null;
  readonly onReset?:(signal?:AbortSignal)=>void|Promise<unknown>;
  readonly integratedLufs: number | null;
  /** Highest 3 s short-term loudness, LUFS. */
  readonly shortTermMaxLufs: number | null;
  /** Highest 400 ms momentary loudness, LUFS. */
  readonly momentaryMaxLufs: number | null;
  /** Highest sample magnitude, dBFS. This is sample peak, not true peak. */
  readonly samplePeakDbfs: number | null;
  /** Momentary loudness per 400 ms block, one block every `stepSeconds`. `null` blocks are silent. */
  readonly momentaryLufs: readonly (number | null)[];
  /** Seconds between momentary blocks (the engine reports 0.1). */
  readonly stepSeconds: number;
  /** Integrated target in LUFS, drawn as a line on the history. @default -14 */
  readonly target?: number;
  /**
   * Called when the person picks another target. Without it the target is
   * shown as text and cannot be changed here. A rejected Promise leaves the
   * `target` prop, and so the selection, unchanged.
   */
  readonly onTargetChange?: (lufs: number) => void | Promise<unknown>;
  /** Target choices. @default LOUDNESS_TARGETS (-14, -16, -23 LUFS) */
  readonly targets?: readonly LoudnessTarget[];
  /** Shown when `status` is `"error"`: what failed, in the app's words. */
  readonly error?: string;
  /** Shown as a Retry button when `status` is `"error"`. */
  readonly onRetry?: () => void;
  /** Disables the target choice and Retry. */
  readonly disabled?: boolean;
  /** Height of the momentary history, in pt. @default 112 */
  readonly historyHeight?: number;
  className?: string;
  unstyled?: boolean;
}

const HIT = 44;
const AXIS = 36;
const GRID = [0, -20, -40, -60] as const;

function TargetChoice({ value, targets, onChange, disabled, unstyled }: {
  value: number; targets: readonly LoudnessTarget[]; onChange: (lufs: number) => void | Promise<unknown>;
  disabled: boolean; unstyled: boolean;
}) {
  const refs = useRef<({ focus?: () => void } | null)[]>([]);
  const pick = (index: number) => {
    const next = targets[(index + targets.length) % targets.length]!;
    refs.current[(index + targets.length) % targets.length]?.focus?.();
    if (next.lufs === value) return;
    Promise.resolve().then(() => onChange(next.lufs)).catch(() => undefined);
  };
  const current = Math.max(0, targets.findIndex(t => t.lufs === value));
  return <View role="radiogroup" aria-label="Loudness target" aria-disabled={disabled || undefined}
    {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }}
    style={{ flexDirection: "row", padding: 2, gap: 2 }}>
    {targets.map((t, i) => {
      const checked = t.lufs === value;
      return <Pressable key={t.lufs} ref={(el: unknown) => { refs.current[i] = el as { focus?: () => void } | null; }} role="radio" aria-checked={checked}
        disabled={disabled} focusable={checked || (i === 0 && !targets.some(x => x.lufs === value))}
        accessibilityLabel={formatLufs(t.lufs) + ", " + t.label}
        onPress={() => pick(i)}
        {...({ onKeyDown: (e: { key: string; preventDefault: () => void; currentTarget?: { closest?: (s: string) => unknown } }) => {
          const rtl = Boolean(e.currentTarget?.closest?.('[dir="rtl"]'));
          const forward = e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight");
          const back = e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft");
          if (!forward && !back) return;
          e.preventDefault();
          if (!disabled) pick(current + (forward ? 1 : -1));
        } } as object)}
        {...{ className: joinClasses(!unstyled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus",
          !unstyled && (checked ? "bg-surface-raised border border-border" : "border border-transparent"),
          !unstyled && disabled && "opacity-50") }}
        style={{ minHeight: HIT, minWidth: 64, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" }}>
        <Text {...{ className: joinClasses(!unstyled && (checked ? "text-text font-semibold" : "text-text-muted")) }}
          style={{ fontSize: 14, fontVariant: ["tabular-nums"] }}>{formatSigned(t.lufs, 0)}</Text>
        <Text {...{ className: joinClasses(!unstyled && "text-text-muted") }} style={{ fontSize: 11 }}>{t.label}</Text>
      </Pressable>;
    })}
  </View>;
}

function Stat({ label, value, note, danger, unstyled }: {
  label: string; value: string; note?: string; danger?: boolean; unstyled: boolean;
}) {
  return <View style={{ minWidth: 132, flexGrow: 1, flexBasis: 132, gap: 2 }}>
    <Text {...{ className: joinClasses(!unstyled && "text-text-muted") }} style={{ fontSize: 12 }}>{label}</Text>
    <Text {...{ className: joinClasses(!unstyled && (danger ? "text-danger font-semibold" : "text-text font-medium")) }}
      style={{ fontSize: 16, fontVariant: ["tabular-nums"] }}>{value}</Text>
    {note ? <Text {...{ className: joinClasses(!unstyled && (danger ? "text-danger" : "text-text-muted")) }}
      style={{ fontSize: 12 }}>{note}</Text> : null}
  </View>;
}

/**
 * Loudness readout for a rendered range: gated integrated loudness against a
 * target, short-term and momentary maxima, sample peak with an overs warning,
 * and the momentary history on a fixed -60..0 LUFS scale with the target
 * line. It reads committed engine results only and measures nothing itself.
 *
 * The engine does not report loudness range (LRA) or true peak, so neither is
 * drawn. Sample peak can miss inter-sample overs.
 */
export function LoudnessMeter({scope='loudness',revision=0,...props}:LoudnessMeterProps){
 if(props.momentaryLufs.length>100000||[props.integratedLufs,props.shortTermMaxLufs,props.momentaryMaxLufs,props.samplePeakDbfs,props.rmsDbfs,...props.momentaryLufs].some(n=>n!==undefined&&n!==null&&!Number.isFinite(n))||!Number.isFinite(props.stepSeconds)||props.stepSeconds<=0)throw new RangeError('Invalid loudness measurements');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.label,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <LoudnessMeterBody {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending} onTargetChange={props.onTargetChange?value=>guard.run('target',h=>h.onTargetChange?.(value)):undefined} onRetry={props.onRetry?()=>guard.run('retry',h=>h.onRetry?.()):undefined} onReset={props.onReset?()=>guard.run('reset',(h,s)=>h.onReset?.(s)):undefined}/>;
}
function LoudnessMeterBody({actionError,disabledReason,rmsDbfs,onReset,

  label, status, integratedLufs, shortTermMaxLufs, momentaryMaxLufs, samplePeakDbfs, momentaryLufs,
  stepSeconds, target = DEFAULT_LOUDNESS_TARGET, onTargetChange, targets = LOUDNESS_TARGETS, error, onRetry,
  disabled = false, historyHeight = 112, className, unstyled = false, style, ...props
}: LoudnessMeterProps&{actionError?:string|null}) {
  const local = useRef<StoreApi<{width:number}> | null>(null);
  if (!local.current) local.current = createStore(() => ({width:0}));
  const store = local.current;
  const width = useStore(store, s => s.width);
  const statusText = status === "measuring" ? "Measuring loudness"
    : status === "error" ? (error ?? "Loudness could not be measured")
    : status === "silent" ? "This range is silent" : "Loudness measured";
  useStatusAnnouncement(statusText);
  const muted = !unstyled ? "text-text-muted" : undefined;
  const summary = describeLoudness({ integratedLufs, shortTermMaxLufs, momentaryMaxLufs, samplePeakDbfs, target });
  const delta = targetDelta(integratedLufs, target);
  const severity = peakSeverity(samplePeakDbfs);
  const peakDanger = severity === "near" || severity === "over";

  const plotWidth = Math.max(0, width - AXIS - 8);
  const bars = momentaryBars(momentaryLufs.length ? momentaryLufs : [null], barCountForWidth(plotWidth, momentaryLufs.length));
  const seconds = historySeconds(momentaryLufs.length, stepSeconds);
  const slot = bars.length ? plotWidth / bars.length : 0;
  const barW = Math.max(1, slot - (slot >= 3 ? 1 : 0));
  let loudest = -1;
  momentaryLufs.forEach((v, i) => { if (v !== null && (loudest < 0 || v > momentaryLufs[loudest]!)) loudest = i; });
  const historyLabel = momentaryLufs.length === 0 ? "No momentary history"
    : "Momentary loudness over " + formatSeconds(seconds) + (loudest >= 0
      ? ", loudest " + formatLufs(momentaryLufs[loudest]!) + " at " + formatSeconds(loudest * stepSeconds) : ", silent")
      + ", target line at " + formatLufs(target);
  const y = (lufs: number) => historyHeight * (1 - lufsToFraction(lufs));

  const header = <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <Text role="heading" aria-level={3} {...{ className: joinClasses(!unstyled && "text-text font-semibold") }}
      style={{ fontSize: 15, flexShrink: 1 }}>{label}</Text>
    {onTargetChange
      ? <TargetChoice value={target} targets={targets} onChange={onTargetChange} disabled={disabled} unstyled={unstyled} />
      : <Text {...{ className: muted }} style={{ fontSize: 13 }}>{"Target " + formatLufs(target)}</Text>}
  </View>;

  let body;
  if (status === "measuring") {
    body = <View style={{ gap: 12 }}>
      <Text accessibilityLiveRegion="polite" {...{ className: muted }} style={{ fontSize: 13 }}>
        Measuring loudness of the selected range
      </Text>
      <View aria-hidden style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }} style={{ flexGrow: 1, flexBasis: 80, height: 40 }} />
        <View {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }} style={{ flexGrow: 1, flexBasis: 80, height: 40 }} />
        <View {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }} style={{ flexGrow: 1, flexBasis: 80, height: 40 }} />
      </View>
      <View aria-hidden {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }} style={{ height: historyHeight }} />
    </View>;
  } else if (status === "error") {
    body = <View accessibilityRole="alert" style={{ gap: 12, alignItems: "flex-start" }}>
      <Text selectable {...{ className: joinClasses(!unstyled && "text-text") }} style={{ fontSize: 14 }}>
        {error ?? "Loudness could not be measured."}
      </Text>
      {onRetry ? <Button title="Measure again" variant="secondary" onPress={onRetry} disabled={disabled} /> : null}
    </View>;
  } else if (status === "silent") {
    body = <Text accessibilityLiveRegion="polite" {...{ className: muted }} style={{ fontSize: 14 }}>
      This range is silent, so there is no loudness to measure. Select a range with audio.
    </Text>;
  } else {
    body = <View style={{ gap: 16 }}>
      <View accessible accessibilityLabel={summary} style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        <View style={{ minWidth: 150, gap: 2 }}>
          <Text {...{ className: muted }} style={{ fontSize: 12 }}>Integrated</Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, direction: "ltr" }}>
            <Text {...{ className: joinClasses(!unstyled && "text-text font-semibold") }}
              style={{ fontSize: 30, lineHeight: 34, fontVariant: ["tabular-nums"] }}>
              {integratedLufs === null ? "No reading" : formatSigned(integratedLufs)}
            </Text>
            {integratedLufs === null ? null : <Text {...{ className: muted }} style={{ fontSize: 14 }}>LUFS</Text>}
          </View>
          <Text {...{ className: joinClasses(!unstyled && "text-text") }} style={{ fontSize: 13 }}>
            {delta ? delta.text : "Too short to gate"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, flexGrow: 1, flexBasis: 280 }}>
          <Stat label="Short-term max" value={formatLufs(shortTermMaxLufs)} unstyled={unstyled} />
          <Stat label="Momentary max" value={formatLufs(momentaryMaxLufs)} unstyled={unstyled} />
          <Stat label="Sample peak" value={formatDbfs(samplePeakDbfs)} note={PEAK_WARNINGS[severity] || undefined}
            danger={peakDanger} unstyled={unstyled} />
        </View>
      </View>
      <View style={{ gap: 4, direction: "ltr" }}>
        <Text aria-hidden {...{ className: muted }} style={{ fontSize: 12 }}>Momentary loudness, LUFS</Text>
        <View role="img" accessibilityLabel={historyLabel}
          onLayout={e => store.setState({width:e.nativeEvent.layout.width})}
          style={{ height: historyHeight, flexDirection: "row" }}>
          <View aria-hidden style={{ width: AXIS, height: historyHeight }}>
            {GRID.map(g => <Text key={g} {...{ className: muted }}
              style={{ position: "absolute", right: 6, top: Math.min(historyHeight - 14, Math.max(0, y(g) - 7)), fontSize: 11, fontVariant: ["tabular-nums"] }}>
              {formatSigned(g, 0)}
            </Text>)}
          </View>
          <View aria-hidden {...{ className: joinClasses(!unstyled && "bg-surface-sunken rounded-control") }}
            style={{ flex: 1, height: historyHeight, marginLeft: 8, overflow: "hidden" }}>
            {GRID.slice(1, -1).map(g => <View key={g} {...{ className: joinClasses(!unstyled && "bg-border") }}
              style={{ position: "absolute", left: 0, right: 0, top: y(g), height: 1 }} />)}
            {bars.map((b, i) => b.fraction > 0 ? <View key={i} {...{ className: joinClasses(!unstyled && "bg-accent") }}
              style={{ position: "absolute", left: i * slot, width: barW, bottom: 0, height: b.fraction * historyHeight,
                borderTopLeftRadius: 1, borderTopRightRadius: 1 }} /> : null)}
            <View {...{ className: joinClasses(!unstyled && "bg-text") }}
              style={{ position: "absolute", left: 0, right: 0, top: y(target) - 1, height: 2 }} />
          </View>
        </View>
        <View aria-hidden style={{ flexDirection: "row", justifyContent: "space-between", marginLeft: AXIS + 8 }}>
          <Text {...{ className: muted }} style={{ fontSize: 11 }}>0 s</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View {...{ className: joinClasses(!unstyled && "bg-text") }} style={{ width: 14, height: 2 }} />
            <Text {...{ className: muted }} style={{ fontSize: 11, fontVariant: ["tabular-nums"] }}>{"Target " + formatLufs(target)}</Text>
          </View>
          <Text {...{ className: muted }} style={{ fontSize: 11, fontVariant: ["tabular-nums"] }}>{formatSeconds(seconds)}</Text>
        </View>
      </View>
    </View>;
  }

  return <View {...props} role="group" aria-label={label} aria-busy={status === "measuring" || undefined}
    {...{ className: joinClasses(!unstyled && "rounded-card border border-border bg-surface-raised", className) }}
    style={[{ padding: 16, gap: 14 }, style]}>
    {header}
    <Text {...{className:!unstyled?'text-text':undefined}}>Measured RMS: {rmsDbfs===undefined||rmsDbfs===null?'Not reported':rmsDbfs.toFixed(2)+' dBFS'}</Text>
    {onReset?<Button title="Reset host loudness integration" disabled={disabled} unstyled={unstyled} onPress={()=>onReset()}/>:null}
    {body}<ErrorMessage message={actionError??disabledReason} unstyled={unstyled}/>
  </View>;
}
