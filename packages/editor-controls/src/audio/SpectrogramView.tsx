import {Button} from '@nyc-tron/ui/components/Button';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {assertWaveformRange,type WaveformRange} from '../waveform.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
/*
 * Structural references (Mobbin, iOS, structure only):
 * - TIDE, Ambient Noise: time-banded history with a step legend under it.
 * - Suno, Extend: audio card with time readouts along the bottom edge.
 * - How We Feel, voice entry: a dense column strip of audio energy.
 * - Facebook, music clip picker: waveform strip with a time window over it.
 */
import { useRef } from "react";
import { Text, View, type ViewProps } from "react-native";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { useStatusAnnouncement } from "@nyc-tron/ui/components/feedback/announce";
import {
  SPECTROGRAM_THRESHOLDS_DB, columnsForWidth, describeSpectrogram, frequencyTicks, poolSpectrogram,
  spectrogramRuns, timeTicks, type IntensityStep,
} from "./spectrogram.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/** Load state of a {@linkcode SpectrogramView}. */
export type SpectrogramStatus = "measuring" | "ready" | "error" | "empty";

/** Props for {@linkcode SpectrogramView}. Data comes from the engine's `spectrogram` op. */
export interface SpectrogramViewProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Name of the analysed range, used as the group label. */
  readonly label: string;
  /** What to draw: a placeholder, the grid, an error or the empty message. */
  readonly status: SpectrogramStatus;
  /** One row per hop, one dB value per band (floored at -120, full-scale sine about 0). */
  readonly frames: readonly (readonly number[])[];
  /** Band centres in Hz, low to high, log-spaced. */
  readonly bandsHz: readonly number[];
  /** Seconds between frames. */
  readonly hopSeconds: number;
  /** Plot height in pt. @default 160 */
  readonly height?: number;
  readonly visibleRange?:WaveformRange;
  readonly onVisibleRangeCommit?:((range:WaveformRange)=>void|Promise<unknown>)|undefined;
  /** Shown when `status` is `"error"`. */
  readonly error?: string;
  className?: string;
  unstyled?: boolean;
}

const AXIS = 52;
/** Sequential single-hue steps, light to dark; tokens only. */
const STEP_CLASS: Record<Exclude<IntensityStep, 0>, string> = {
  1: "bg-primary/15", 2: "bg-primary/30", 3: "bg-primary/50", 4: "bg-primary/75", 5: "bg-primary",
};

/**
 * Spectrogram drawn with plain Views: time runs left to right (also in RTL),
 * low frequencies at the bottom. The engine matrix is max-pooled to at most
 * 96 columns by measured width and 32 rows, then mapped to five intensity
 * steps; equal adjacent cells merge into one View, so the drawn count stays
 * at or under 96 x 32.
 */
export function SpectrogramView({scope='spectrogram',revision=0,...props}:SpectrogramViewProps){
 const range=props.visibleRange??{start:0,end:1};assertWaveformRange(range);
 if(props.frames.length>32768||props.bandsHz.length>512||props.frames.length*props.bandsHz.length>2097152||props.frames.some(f=>f.length!==props.bandsHz.length||f.some(n=>!Number.isFinite(n)))||props.bandsHz.some((n,i)=>!Number.isFinite(n)||n<=0||i>0&&n<=props.bandsHz[i-1]!)||!Number.isFinite(props.hopSeconds)||props.hopSeconds<=0||!Number.isFinite(props.frames.length*props.hopSeconds)||!Number.isFinite(props.height??160)||(props.height??160)<44||(props.height??160)>4096)throw new RangeError('Invalid spectrogram data');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason]),guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <SpectrogramViewBody {...props} actionError={guard.error} onVisibleRangeCommit={props.onVisibleRangeCommit?range=>guard.run('range',h=>h.onVisibleRangeCommit?.(range)):undefined}/>;
}
function SpectrogramViewBody({actionError,disabledReason,visibleRange={start:0,end:1},onVisibleRangeCommit,

  label, status, frames:sourceFrames, bandsHz, hopSeconds, height = 160, error, className, unstyled = false, style, ...props
}: SpectrogramViewProps&{actionError?:string|null}) {
  const start=Math.floor(visibleRange.start*sourceFrames.length),end=Math.max(start+1,Math.ceil(visibleRange.end*sourceFrames.length)),frames=sourceFrames.slice(start,end);
  const span=visibleRange.end-visibleRange.start;
  const rangeAt=(left:number,size=span)=>({start:Math.min(1-size,Math.max(0,left)),end:Math.min(1-size,Math.max(0,left))+size});
  const local = useRef<StoreApi<{width:number}> | null>(null);
  if (!local.current) local.current = createStore(() => ({width:0}));
  const store = local.current;
  const width = useStore(store, s => s.width);
  const statusText = status === "measuring" ? "Analysing spectrum" : status === "error" ? (error ?? "Spectrum could not be analysed")
    : status === "empty" ? "Nothing to analyse" : "Spectrum ready";
  useStatusAnnouncement(statusText);
  const muted = !unstyled ? "text-text-muted" : undefined;
  const plotWidth = Math.max(0, width - AXIS);
  const ready = status === "ready" && frames.length > 0 && bandsHz.length > 0;
  const grid = ready && plotWidth > 0
    ? poolSpectrogram(frames, bandsHz.length, columnsForWidth(plotWidth, frames.length)) : undefined;
  const runs = grid ? spectrogramRuns(grid) : [];
  const duration = frames.length * hopSeconds;
  // Whole-point edges so neighbouring runs share a boundary with no seam.
  const edges = (column: number, span: number, row: number) => {
    const x0 = Math.round(column * plotWidth / grid!.columns), x1 = Math.round((column + span) * plotWidth / grid!.columns);
    const y0 = Math.round(row * height / grid!.rows), y1 = Math.round((row + 1) * height / grid!.rows);
    return { position: "absolute" as const, left: x0, width: x1 - x0, bottom: y0, height: y1 - y0 };
  };
  const summary = ready ? describeSpectrogram(frames, bandsHz, hopSeconds) : statusText;

  let body;
  if (status === "measuring") {
    body = <View style={{ gap: tokens.spacing.fixedElement }}>
      <Text accessibilityLiveRegion="polite" {...{ className: muted }} style={{ fontSize: tokens.text.off13 }}>Analysing the spectrum of the selected range</Text>
      <View aria-hidden {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }} style={{ height }} />
    </View>;
  } else if (status === "error") {
    body = <View accessibilityRole="alert"><Text selectable {...{ className: joinClasses(!unstyled && "text-text") }} style={{ fontSize: tokens.text.body }}>
      {error ?? "The spectrum could not be analysed."}</Text></View>;
  } else if (!ready) {
    body = <Text accessibilityLiveRegion="polite" {...{ className: muted }} style={{ fontSize: tokens.text.body }}>
      There is no audio in this range to analyse. Select a range with audio.
    </Text>;
  } else {
    body = <View style={{ gap: tokens.spacing.off6, direction: "ltr" }}>
      <View role="img" accessibilityLabel={summary} onLayout={e => store.setState({width:e.nativeEvent.layout.width})}
        style={{ flexDirection: "row", height }}>
        <View aria-hidden style={{ width: AXIS, height }}>
          {frequencyTicks(bandsHz).map(t => <Text key={t.label} {...{ className: muted }}
            style={{ position: "absolute", right: tokens.spacing.fixedElement, fontSize: tokens.text.off11, fontVariant: ["tabular-nums"],
              top: Math.min(height - 14, Math.max(0, height * (1 - t.position) - 7)) }}>{t.label}</Text>)}
        </View>
        <View aria-hidden testID={props.testID ? props.testID + "-plot" : undefined}
          {...{ className: joinClasses(!unstyled && "rounded-control bg-surface-sunken") }}
          style={{ flex: 1, height, overflow: "hidden" }}>
          {grid ? runs.map(r => <View key={r.row + ":" + r.column} {...{ className: joinClasses(!unstyled && STEP_CLASS[r.step]) }}
            style={edges(r.column, r.span, r.row)} />) : null}
        </View>
      </View>
      <View aria-hidden style={{ marginLeft: AXIS, height: tokens.spacing.fixedGroup }}>
        {timeTicks(duration).map((t, i, all) => <Text key={t.label} {...{ className: muted }}
          style={{ position: "absolute", fontSize: tokens.text.off11, fontVariant: ["tabular-nums"],
            ...(i === 0 ? { left: 0 } : i === all.length - 1 && t.position > 0.92
              ? { right: ((1 - t.position) * 96) + "%" }
              : { left: (t.position * 96) + "%", transform: [{ translateX: "-50%" }] }) }}>{t.label}</Text>)}
      </View>
      <View aria-hidden style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.off6, marginLeft: AXIS, flexWrap: "wrap" }}>
        <Text {...{ className: muted }} style={{ fontSize: tokens.text.off11 }}>Quiet</Text>
        {([1, 2, 3, 4, 5] as const).map(s => <View key={s} {...{ className: joinClasses(!unstyled && STEP_CLASS[s], !unstyled && "rounded-sm") }}
          style={{ width: tokens.spacing.fixedGroup, height: tokens.spacing.off10 }} />)}
        <Text {...{ className: muted }} style={{ fontSize: tokens.text.off11 }}>
          {"Loud (steps at " + SPECTROGRAM_THRESHOLDS_DB.map(d => "−" + -d).join(", ") + " dB)"}
        </Text>
      </View>
    </View>;
  }

  return <View {...props} role="group" aria-label={label} aria-busy={status === "measuring" || undefined}
    {...{ className: joinClasses(!unstyled && "rounded-card border border-border bg-surface-raised", className) }}
    style={[{ padding: tokens.spacing.fixedGroup, gap: tokens.spacing.fixedInset }, style]}>
    <Text role="heading" aria-level={3} {...{ className: joinClasses(!unstyled && "text-text font-semibold") }} style={{ fontSize: tokens.text.off15 }}>{label}</Text>
    {onVisibleRangeCommit?<View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.off6}}>
     <Button title="Zoom into spectrum" disabled={disabledReason!==undefined||sourceFrames.length<2||span<=1/Math.max(1,sourceFrames.length)} unstyled={unstyled} onPress={()=>onVisibleRangeCommit(rangeAt(visibleRange.start+span/4,Math.max(1/Math.max(1,sourceFrames.length),span/2)))}/>
     <Button title="Zoom out of spectrum" disabled={disabledReason!==undefined||span>=1} unstyled={unstyled} onPress={()=>onVisibleRangeCommit(rangeAt(visibleRange.start-span/2,Math.min(1,span*2)))}/>
     <Button title="Earlier spectrum" disabled={disabledReason!==undefined||visibleRange.start===0} unstyled={unstyled} onPress={()=>onVisibleRangeCommit(rangeAt(visibleRange.start-span/2))}/>
     <Button title="Later spectrum" disabled={disabledReason!==undefined||visibleRange.end===1} unstyled={unstyled} onPress={()=>onVisibleRangeCommit(rangeAt(visibleRange.start+span/2))}/>
    </View>:null}
    <Text {...{className:muted}}>Source window {(start*hopSeconds).toFixed(3)}–{(Math.min(end,sourceFrames.length)*hopSeconds).toFixed(3)} s</Text>
    {body}<ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/>
  </View>;
}
