import {audioTargetSize,audioCopy} from './audio-chrome.ts';
/**
 * Row of mix group chips with group solo and mute.
 *
 * Structural references (Mobbin, iOS; structure only):
 * - Discord, voice settings sheet: an input meter drawn as a filled bar
 *   directly under the control it reports on.
 * - Facebook, video volume sheet: one row per source with its own mute
 *   toggle next to the level, sources grouped in separate rounded rows.
 * - Waymo, audio settings: "Balance and fade" as its own labelled control,
 *   separate from per-band levels.
 * - Opal, sound mix: one vertical level column per source, side by side,
 *   each named underneath.
 */
import { Platform, Pressable, Text, View, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import type { MixGroup, mixGroups } from "./mix-groups.ts";
import { controlTokens, tokens } from "../tokens.ts";


export interface MixGroupLabels {
 region:string;solo:string;mute:string;someSoloed:string;someMuted:string;
 memberCount:(count:number)=>string;groupName:(name:string,count:string)=>string;
 soloName:(name:string)=>string;muteName:(name:string)=>string;
}
const defaultGroupLabels:MixGroupLabels={region:'Mix groups',solo:'Solo',mute:'Mute',someSoloed:'Some members soloed',someMuted:'Some members muted',
 memberCount:n=>n+(n===1?' channel':' channels'),groupName:(name,count)=>name+' group, '+count,soloName:name=>'Solo group '+name,muteName:name=>'Mute group '+name};

/** Props for {@linkcode MixGroupBar}. */
export interface MixGroupBarProps extends Omit<ViewProps, "children"> {
  /** App-owned minimum interaction target. Defaults to 44 points. */
  readonly targetSize?: number;
  readonly labels?:Partial<MixGroupLabels>|undefined;
  /** From {@linkcode mixGroups}, in display order. */
  readonly groups: readonly MixGroup[];
  /**
   * Once per press. Requests `false` when every member is soloed, `true`
   * otherwise (including the mixed state). The engine applies it to every
   * member as one undo step.
   */
  readonly onGroupSoloCommit: (group: string, solo: boolean) => void | Promise<unknown>;
  /** Once per press, with the same rule as solo. */
  readonly onGroupMutedCommit: (group: string, muted: boolean) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  unstyled?: boolean;
}

type Tri = boolean | "mixed";

function toggleA11y(state: Tri, disabled: boolean): Record<string, unknown> {
  // React Native Web passes `togglebutton` through as an unknown role, so
  // web gets a button with aria-pressed (which also carries "mixed").
  return Platform.OS === "web"
    ? { role: "button", "aria-pressed": state, "aria-disabled": disabled || undefined }
    : { accessibilityRole: "togglebutton", accessibilityState: { checked: state, disabled } };
}

/**
 * Controlled mix group chips: name, member count, and Solo and Mute toggles
 * for the whole group. A group where only some members are soloed (or
 * muted) shows that toggle as mixed: a dashed outline, `aria-pressed="mixed"`
 * on web and `checked: "mixed"` on iOS and Android.
 *
 * {@linkcode MixingConsole} draws this bar above the strips when a channel
 * has a group and both group callbacks are passed.
 */
export function MixGroupBar({
  groups, onGroupSoloCommit, onGroupMutedCommit, disabled = false, targetSize, labels, className, unstyled = false, ...rest
}: MixGroupBarProps) {
  const HIT = audioTargetSize(targetSize);
  const copy = audioCopy(defaultGroupLabels, labels);
  const styled = !unstyled;
  const toggle = (kind: "Solo" | "Mute", group: MixGroup) => {
    const state: Tri = kind === "Solo"
      ? (group.mixed ? "mixed" : group.solo)
      : (group.mutedMixed ? "mixed" : group.muted);
    const on = state === true;
    const fill = kind === "Solo" ? "bg-accent border-accent" : "bg-primary border-primary";
    const onText = kind === "Solo" ? "text-surface-raised" : "text-on-primary";
    return <Pressable key={kind} {...toggleA11y(state, disabled)}
      accessibilityLabel={(kind==="Solo"?copy.soloName:copy.muteName)(group.name)}
      accessibilityHint={state === "mixed" ? (kind === "Solo" ? copy.someSoloed : copy.someMuted) : undefined}
      disabled={disabled}
      onPress={() => { void (kind === "Solo" ? onGroupSoloCommit : onGroupMutedCommit)(group.name, !on); }}
      {...{ className: joinClasses(styled && "rounded-control items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
        styled && (on ? fill : state === "mixed" ? "border-accent bg-surface-raised" : "border-border bg-surface-raised")) }}
      style={{ minWidth: HIT + tokens.spacing.fixedElement, minHeight: HIT, paddingHorizontal: tokens.spacing.fixedElement, borderWidth: tokens.borderWidth.strong,
        borderStyle: state === "mixed" ? "dashed" : "solid", opacity: disabled ? tokens.opacity.disabled : 1 }}>
      <Text {...{ className: joinClasses(styled && "font-semibold", styled && (on ? onText : "text-text")) }}>{kind==="Solo"?copy.solo:copy.mute}</Text>
    </Pressable>;
  };
  return <View {...rest} accessibilityLabel={copy.region} {...{ role: "group" }}
    {...{ className: joinClasses("flex-row flex-wrap gap-2", className) }}>
    {groups.map(group => {
      const count = copy.memberCount(group.memberIds.length);
      return <View key={group.name} {...{ role: "group", "aria-label": copy.groupName(group.name,count) }}
        {...{ className: joinClasses("flex-row items-center gap-2", styled && "rounded-control border border-border bg-surface-sunken") }}
        style={{ flexWrap:"wrap", maxWidth:"100%", paddingVertical: tokens.spacing.fixedStack, paddingStart: tokens.spacing.off10, paddingEnd: tokens.spacing.fixedStack }}>
        <View style={{ minWidth: tokens.spacing.fixedToolbar, maxWidth: controlTokens.extent.fieldWide }}>
          <Text numberOfLines={1} {...{ className: joinClasses(styled && "font-semibold text-text") }}>{group.name}</Text>
          <Text numberOfLines={1} {...{ className: joinClasses(styled && "text-xs text-text-muted") }}>{count}</Text>
        </View>
        {toggle("Solo", group)}
        {toggle("Mute", group)}
      </View>;
    })}
  </View>;
}
