import {audioTargetSize} from './audio-chrome.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {InsertEffectRack,type InsertEffectRackProps} from './InsertEffectRack.tsx';
import {BusAndRoutingMatrix,type BusAndRoutingMatrixProps} from './BusAndRoutingMatrix.tsx';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { ScrollView, View, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { EmptyState, type EmptyStateExit } from "@nyc-tron/ui/components/feedback/EmptyState";
import { ChannelStrip, channelRouting, type ChannelStripProps, type ChannelMeter } from "./ChannelStrip.tsx";
import { MixGroupBar, type MixGroupBarProps } from "./MixGroupBar.tsx";
import { FADER_RANGES, type FaderRange } from "./level.ts";
import { mixGroups } from "./mix-groups.ts";
import { audibility, type MixerChannel } from "./mixer.ts";
import {exact} from '../exact-optional.ts';

type Id = MixerChannel["id"];

/** Props for {@linkcode MixingConsole}. */
export interface MixingConsoleProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** App-owned minimum interaction target. Defaults to 44 points. */
  readonly targetSize?: number;
  readonly channelLabels?:ChannelStripProps["labels"];
  readonly groupLabels?:MixGroupBarProps["labels"];
  readonly emptyLabels?:{title?:string;description?:string};
  /** Committed channel state from the engine, tracks and buses in strip order. */
  readonly channels: readonly MixerChannel[];
  readonly insertRacks?:Readonly<Record<string,Omit<InsertEffectRackProps,'label'|'scope'|'revision'|'disabled'|'unstyled'>>>;
  readonly routing?:Omit<BusAndRoutingMatrixProps,'scope'|'revision'|'disabled'|'unstyled'>;
  readonly onGainCommit: (id: Id, gain: number) => void | Promise<unknown>;
  /** Pan on a track, balance on a bus. */
  readonly onPanCommit: (id: Id, pan: number) => void | Promise<unknown>;
  readonly onMutedCommit: (id: Id, muted: boolean) => void | Promise<unknown>;
  readonly onSoloCommit: (id: Id, solo: boolean) => void | Promise<unknown>;
  /** When given, every strip draws a solo-safe toggle. */
  readonly onSoloSafeCommit?: ((id: Id, safe: boolean) => void | Promise<unknown>) | undefined;
  /**
   * Group solo for every member as one engine step. With
   * {@linkcode MixingConsoleProps.onGroupMutedCommit} and at least one
   * grouped channel, a group bar is drawn above the strips.
   */
  readonly onGroupSoloCommit?: ((group: string, solo: boolean) => void | Promise<unknown>) | undefined;
  /** Group mute for every member as one engine step. */
  readonly onGroupMutedCommit?: ((group: string, muted: boolean) => void | Promise<unknown>) | undefined;
  /** Live gain preview, e.g. for an audio graph that follows the drag. */
  readonly onGainChange?: ((id: Id, gain: number) => void) | undefined;
  readonly onPanChange?: ((id: Id, pan: number) => void) | undefined;
  /**
   * Meter values keyed by `String(channel.id)`: linear sample peak from the
   * Cadence `meter` op, after `createPeakHold`. Omit it and no meters are
   * drawn; a channel missing from the record draws an empty meter.
   */
  readonly meters?: Readonly<Record<string, ChannelMeter>>;
  /** @default FADER_RANGES.UNITY */
  readonly range?: FaderRange;
  /** @default 160 */
  readonly faderLength?: number;
  /**
   * The way out when there are no channels, e.g. "Add track". Without it the
   * empty state only explains what is missing.
   */
  readonly emptyAction?: EmptyStateExit;
  /** @default false */
  readonly disabled?: boolean;
  /** Accessible name of the console region. @default "Mixer" */
  readonly label?: string;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled channel-strip console for tracks and buses. Strips scroll
 * horizontally; faders claim only vertical drags, so a sideways swipe
 * across them scrolls. Audibility (solo over mute, solo safe, solo through
 * a bus) is computed across all channels the same way the Cadence engine
 * renders.
 *
 * Draws: per-strip sample-peak meters when `meters` is passed, a mix group
 * bar with group solo and mute, solo-safe toggles, bus strips with balance,
 * and each track's output bus.
 *
 * Optional insert racks and routing reuse their independent controls. Sample-peak
 * telemetry stays distinct from true peaks; surround has its own speaker-field control.
 */
export function MixingConsole({scope='MixingConsole',revision=0,...props}:MixingConsoleProps){
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),props.channels.map(c=>[c.id,c.kind,c.group]),props.range,props.faderLength,props.disabled,props.disabledReason])]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <MixingConsoleBody key={owner} {...props} scope={owner} revision={revision} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onGainCommit={(...args:Parameters<MixingConsoleProps['onGainCommit']>)=>guard.run('onGainCommit',h=>h.onGainCommit(...args))}
  onPanCommit={(...args:Parameters<MixingConsoleProps['onPanCommit']>)=>guard.run('onPanCommit',h=>h.onPanCommit(...args))}
  onMutedCommit={(...args:Parameters<MixingConsoleProps['onMutedCommit']>)=>guard.run('onMutedCommit',h=>h.onMutedCommit(...args))}
  onSoloCommit={(...args:Parameters<MixingConsoleProps['onSoloCommit']>)=>guard.run('onSoloCommit',h=>h.onSoloCommit(...args))}
  onSoloSafeCommit={props.onSoloSafeCommit?(...args:Parameters<NonNullable<MixingConsoleProps['onSoloSafeCommit']>>)=>guard.run('onSoloSafeCommit',h=>h.onSoloSafeCommit?.(...args)):undefined}
  onGroupSoloCommit={props.onGroupSoloCommit?(...args:Parameters<NonNullable<MixingConsoleProps['onGroupSoloCommit']>>)=>guard.run('onGroupSoloCommit',h=>h.onGroupSoloCommit?.(...args)):undefined}
  onGroupMutedCommit={props.onGroupMutedCommit?(...args:Parameters<NonNullable<MixingConsoleProps['onGroupMutedCommit']>>)=>guard.run('onGroupMutedCommit',h=>h.onGroupMutedCommit?.(...args)):undefined}
  onGainChange={props.onGainChange?(...args:Parameters<NonNullable<MixingConsoleProps['onGainChange']>>)=>{guard.current()?.onGainChange?.(...args);}:undefined}
  onPanChange={props.onPanChange?(...args:Parameters<NonNullable<MixingConsoleProps['onPanChange']>>)=>{guard.current()?.onPanChange?.(...args);}:undefined}
 />;
}
function MixingConsoleBody({actionError,disabledReason,scope='mixing-console',revision=0,insertRacks,routing,
  channels, onGainCommit, onPanCommit, onMutedCommit, onSoloCommit, onSoloSafeCommit,
  onGroupSoloCommit, onGroupMutedCommit, onGainChange, onPanChange, meters,
  range = FADER_RANGES.UNITY, faderLength = 160, emptyAction, disabled = false, label = "Mixer",
  className, unstyled = false, targetSize, channelLabels, groupLabels, emptyLabels, ...rest
}: MixingConsoleProps&{actionError?:string|null}) {
  const target = audioTargetSize(targetSize);
  const styled = !unstyled;
  if(channels.length>256||new Set(channels.map(c=>String(c.id))).size!==channels.length||channels.some(c=>typeof c.id==='number'&&!Number.isFinite(c.id)||String(c.id).length>256||!c.name.trim()||c.name.length>1024||!Number.isFinite(c.gain)||c.gain<0||!Number.isFinite(c.pan)||Math.abs(c.pan)>1))throw new RangeError('Invalid mixer channels');
  const states = audibility(channels);
  if (channels.length === 0) {
    return <EmptyState {...rest} title={emptyLabels?.title ?? "No tracks to mix"}
      description={emptyLabels?.description ?? "Add a track to the project and its channel strip appears here."}
      {...(emptyAction===undefined?{}:{exitAction:emptyAction})}
      {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised", className) }} />;
  }
  const busNames = new Map<Id, string>();
  for (const c of channels) if (c.kind === "bus") busNames.set(c.id, c.name);
  const outputNameOf = (c: MixerChannel) =>
    c.output === undefined || c.output === null ? undefined : busNames.get(c.output);
  const routingLines = Math.max(0, ...channels.map(c => channelRouting(c, outputNameOf(c)).length));
  const groups = onGroupSoloCommit && onGroupMutedCommit ? mixGroups(channels) : [];
  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised", className) }}>
    {groups.length > 0 && onGroupSoloCommit && onGroupMutedCommit
      ? <MixGroupBar targetSize={target} labels={groupLabels} groups={groups} disabled={disabled} unstyled={unstyled}
        onGroupSoloCommit={onGroupSoloCommit} onGroupMutedCommit={onGroupMutedCommit}
        {...{ className: joinClasses(styled && "border-b border-border") }}
        style={{ padding: 8 }} />
      : null}
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingHorizontal: 4 }}>
      {channels.map((channel, i) => <View key={channel.id} style={{ flexDirection: "row" }}>
        {i > 0 ? <View {...{ className: joinClasses(styled && "bg-border") }} style={{ width: 1, alignSelf: "stretch" }} /> : null}
        <View style={{gap:8}}><ChannelStrip targetSize={target} labels={channelLabels} channel={channel} audibility={states[i]} range={range} faderLength={faderLength}
          disabled={disabled} unstyled={unstyled} outputName={outputNameOf(channel)} routingLines={routingLines}
          meter={meters ? meters[String(channel.id)] ?? { peak: 0 } : undefined}
          onGainCommit={gain => onGainCommit(channel.id, gain)}
          onPanCommit={pan => onPanCommit(channel.id, pan)}
          onMutedCommit={muted => onMutedCommit(channel.id, muted)}
          onSoloCommit={solo => onSoloCommit(channel.id, solo)}
          onSoloSafeCommit={onSoloSafeCommit ? safe => onSoloSafeCommit(channel.id, safe) : undefined}
          onGainChange={onGainChange ? gain => onGainChange(channel.id, gain) : undefined}
          onPanChange={onPanChange ? pan => onPanChange(channel.id, pan) : undefined} />
        {insertRacks?.[String(channel.id)]?<InsertEffectRack {...insertRacks[String(channel.id)]!} label={channel.name} scope={scope+':inserts:'+String(channel.id)} revision={revision} disabled={disabled} unstyled={unstyled}/>:null}</View>
      </View>)}
    </ScrollView>
    {routing?<BusAndRoutingMatrix {...routing} scope={scope+':routing'} revision={revision} disabled={disabled} unstyled={unstyled}/>:null}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
