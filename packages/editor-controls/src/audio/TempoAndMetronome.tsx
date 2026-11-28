import {forgeRadius} from "../radius.ts";
import {audioTargetSize,audioCopy} from './audio-chrome.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { useEffect, useRef } from "react";
import { Pressable, Text, View, type KeyDownEvent, type ViewProps } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { PrecisionScrubber, type PrecisionScrubberProps } from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {
  MAX_BPM, MAX_NUMERATOR, MIN_BPM, TAP_RESET_MS, TIME_SIG_DENOMINATORS,
  addTap, clampBpm, formatTimeSignature, isValidTimeSignature, tapTempo, type TimeSignature,
} from "./tempo.ts";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";


export interface TempoLabels {
  tempo:string; tap:string; tapName:string; tapHint:string; keepTapping:string;
  estimate:(bpm:number,taps:number)=>string;
  timeSignature:string; beatsPerBar:string; fewerBeats:string; moreBeats:string;
  beatUnit:string; unitName:(unit:number)=>string; metronome:string; clickOn:string; clickOff:string;
  beatName:(beat:number,total:number)=>string;
  precision?:PrecisionScrubberProps['labels'];
}
const defaultTempoLabels:TempoLabels={tempo:'Tempo',tap:'Tap',tapName:'Tap tempo',tapHint:'Tap on each beat. The tempo is set when you stop tapping.',keepTapping:'Keep tapping',
 estimate:(bpm,taps)=>bpm.toFixed(1)+' BPM from '+taps+' taps',timeSignature:'Time signature',beatsPerBar:'Beats per bar',fewerBeats:'Fewer beats per bar',moreBeats:'More beats per bar',
 beatUnit:'Beat unit',unitName:unit=>'Beat unit '+unit,metronome:'Metronome',clickOn:'Click on',clickOff:'Click off',beatName:(beat,total)=>'Beat '+beat+' of '+total};

/** Metronome switch, owned by whatever plays the click. */
export interface MetronomeBinding {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void | Promise<unknown>;
}

/** Props for {@linkcode TempoAndMetronome}. */
export interface TempoAndMetronomeProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** App-owned minimum interaction target. Defaults to 44 points. */
  readonly targetSize?: number;
  readonly labels?: Partial<TempoLabels>;
  /** Committed tempo, 20..400 BPM. */
  readonly bpm: number;
  /** Committed time signature, `[numerator, denominator]`. */
  readonly timeSignature: TimeSignature;
  /** Once per drag, step, text entry or finished tap sequence. */
  readonly onTempoCommit: (bpm: number) => void | Promise<unknown>;
  /** Once per numerator step or denominator choice. */
  readonly onTimeSignatureCommit: (timeSignature: TimeSignature) => void | Promise<unknown>;
  /**
   * The click switch. Leave it out when nothing can play a click: the
   * control is then not drawn, rather than drawn and dead.
   */
  readonly metronome?: MetronomeBinding | undefined;
  /**
   * Zero-based beat in the bar while the transport runs, for the visual
   * click. Leave it out when stopped.
   */
  readonly beat?: number;
  /** Clock for tap tempo, ms. @default Date.now */
  readonly now?: () => number;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  unstyled?: boolean;
}

type Taps = { taps: number[] };

/**
 * Tempo, tap tempo, time signature and metronome. Controlled: the app passes
 * committed values and receives one commit per finished gesture.
 *
 * Tap tempo shows its estimate while tapping and commits once, when the
 * taps stop for {@linkcode TAP_RESET_MS}. Escape on the tap button drops the
 * sequence without committing. The click sound belongs to the audio layer;
 * this control only shows the beat it is given.
 */
export function TempoAndMetronome({scope='TempoAndMetronome',revision=0,...props}:TempoAndMetronomeProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabled,props.disabledReason,props.timeSignature]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <TempoAndMetronomeBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  metronome={props.metronome?{...props.metronome,onChange:value=>guard.run('metronome',h=>h.metronome?.onChange(value))}:undefined}
  onTempoCommit={(...args:Parameters<TempoAndMetronomeProps['onTempoCommit']>)=>guard.run('onTempoCommit',h=>h.onTempoCommit(...args))}
  onTimeSignatureCommit={(...args:Parameters<TempoAndMetronomeProps['onTimeSignatureCommit']>)=>guard.run('onTimeSignatureCommit',h=>h.onTimeSignatureCommit(...args))}
 />;
}
function TempoAndMetronomeBody({actionError,disabledReason,
  bpm, timeSignature, onTempoCommit, onTimeSignatureCommit, metronome, beat, now = Date.now,
  disabled = false, targetSize, labels, className, unstyled = false, ...rest
}: TempoAndMetronomeProps&{actionError?:string|null}) {
  const HIT = audioTargetSize(targetSize);
  const copy = audioCopy(defaultTempoLabels, labels);
  const [numerator, denominator] = timeSignature;
  if (!isValidTimeSignature(timeSignature)) throw new RangeError("Invalid time signature " + formatTimeSignature(timeSignature));
  const latest = useRef({ bpm, onTempoCommit, disabled });
  latest.current = { bpm, onTempoCommit, disabled };
  const local = useRef<StoreApi<Taps> | null>(null);
  if (!local.current) local.current = createStore<Taps>(() => ({ taps: [] }));
  const store = local.current;
  const taps = useStore(store, s => s.taps);
  const estimate = tapTempo(taps);

  // Commit the tap estimate once the sequence goes quiet.
  useEffect(() => {
    if (taps.length < 2) return;
    const timer = setTimeout(() => {
      const next = tapTempo(store.getState().taps);
      store.setState({ taps: [] });
      const p = latest.current;
      if (next !== undefined && !p.disabled && next !== p.bpm) void p.onTempoCommit(next);
    }, TAP_RESET_MS);
    return () => clearTimeout(timer);
  }, [taps, store]);
  useEffect(() => () => store.setState({ taps: [] }), [store]);

  const styled = !unstyled;
  const chip = (on: boolean) => joinClasses(styled && "rounded-control items-center justify-center border focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
    styled && (on ? "bg-primary border-primary" : "bg-surface-sunken border-border"));
  const chipText = (on: boolean) => joinClasses(styled && "font-semibold", styled && (on ? "text-on-primary" : "text-text"));
  const box = { minWidth: HIT, minHeight: HIT, paddingHorizontal: tokens.spacing.off10, opacity: disabled ? tokens.opacity.disabled : 1 };
  const muted = joinClasses(styled && "text-text-muted");
  const setNumerator = (n: number) => {
    if (disabled || n < 1 || n > MAX_NUMERATOR || n === numerator) return;
    void onTimeSignatureCommit([n, denominator]);
  };
  const tap = () => { if (!disabled) store.setState(s => ({ taps: addTap(s.taps, now()) })); };
  const onTapKey = (e: KeyDownEvent) => {
    if (e.nativeEvent.key === "Escape" && store.getState().taps.length) { e.preventDefault(); store.setState({ taps: [] }); }
  };

  return <View {...rest} {...{ className: joinClasses("gap-4", styled && "rounded-card border border-border bg-surface-raised p-4", className) }}>
    <PrecisionScrubber targetSize={HIT} {...(copy.precision===undefined?{}:{labels:copy.precision})} label={copy.tempo} value={clampBpm(bpm)} min={MIN_BPM} max={MAX_BPM} step={1} unit=" BPM"
      disabled={disabled} unstyled={unstyled} onCommit={onTempoCommit} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.spacing.fixedElement }}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.tapName}
        accessibilityHint={copy.tapHint}
        accessibilityValue={estimate === undefined ? undefined : { text: estimate.toFixed(1) + " BPM" }}
        disabled={disabled} onPress={tap} onKeyDown={onTapKey}
        {...{ className: chip(taps.length > 0) }} style={box}>
        <Text {...{ className: chipText(taps.length > 0) }}>{copy.tap}</Text>
      </Pressable>
      <Text {...{ className: muted }} accessibilityLiveRegion="polite" style={{ fontVariant: ["tabular-nums"] }}>
        {estimate !== undefined ? copy.estimate(estimate,taps.length)
          : taps.length === 1 ? copy.keepTapping : ""}
      </Text>
    </View>
    <View style={{ gap: tokens.spacing.fixedElement }}>
      <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>{copy.timeSignature}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.spacing.fixedElement }}>
        <View accessible accessibilityRole="adjustable" accessibilityLabel={copy.beatsPerBar}
          accessibilityValue={{ min: 1, max: MAX_NUMERATOR, now: numerator }}
          accessibilityActions={[{ name: "increment",label:copy.moreBeats }, { name: "decrement",label:copy.fewerBeats }]}
          onAccessibilityAction={e => setNumerator(numerator + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
          style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.fixedStack }}>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.fewerBeats}
            disabled={disabled || numerator <= 1} onPress={() => setNumerator(numerator - 1)}
            {...{ className: chip(false) }} style={box}><Text {...{ className: chipText(false) }}>−</Text></Pressable>
          <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}
            style={{ minWidth: tokens.spacing.fixedStatus, textAlign: "center", fontVariant: ["tabular-nums"] }}>{numerator}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.moreBeats}
            disabled={disabled || numerator >= MAX_NUMERATOR} onPress={() => setNumerator(numerator + 1)}
            {...{ className: chip(false) }} style={box}><Text {...{ className: chipText(false) }}>+</Text></Pressable>
        </View>
        {/* The slash travels with the unit chips so a wrap never strands it. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.fixedElement }}>
        <Text {...{ className: muted }}>/</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={copy.beatUnit} style={{ flexDirection: "row", flexWrap:"wrap", gap: tokens.spacing.fixedStack }}>
          {TIME_SIG_DENOMINATORS.map(d => <Pressable key={d} accessibilityRole="radio"
            accessibilityLabel={copy.unitName(d)} accessibilityState={{ checked: d === denominator, disabled }}
            disabled={disabled} onPress={() => { if (d !== denominator) void onTimeSignatureCommit([numerator, d]); }}
            {...{ className: chip(d === denominator) }} style={box}>
            <Text {...{ className: chipText(d === denominator) }}>{d}</Text>
          </Pressable>)}
        </View>
        </View>
      </View>
    </View>
    {metronome || beat !== undefined ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.spacing.fixedInset }}>
      {metronome ? <Pressable accessibilityRole="switch" accessibilityLabel={copy.metronome}
        accessibilityState={{ checked: metronome.enabled, disabled }} disabled={disabled}
        onPress={() => { void metronome.onChange(!metronome.enabled); }}
        {...{ className: chip(metronome.enabled) }} style={box}>
        <Text {...{ className: chipText(metronome.enabled) }}>{metronome.enabled ? copy.clickOn : copy.clickOff}</Text>
      </Pressable> : null}
      {beat !== undefined ? <View accessible accessibilityRole="text"
        accessibilityLabel={copy.beatName((beat % numerator)+1,numerator)}
        style={{ flexDirection: "row", gap: tokens.spacing.off6, alignItems: "center" }}>
        {Array.from({ length: Math.min(numerator, 16) }, (_, i) => {
          const on = i === beat % numerator;
          return <View key={i} {...{ className: joinClasses(styled && (on ? (i === 0 ? "bg-primary" : "bg-accent") : "bg-surface-sunken border border-border")) }}
            style={{ width: i === 0 ? tokens.spacing.off14 : tokens.spacing.off10, height: i === 0 ? tokens.spacing.off14 : tokens.spacing.off10, borderRadius: forgeRadius.sm }} />;
        })}
      </View> : null}
    </View> : null}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
