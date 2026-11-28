import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
/**
 * Insert effect rack (roster E-20).
 *
 * Original implementation; no CapCraft source consulted. Built from the
 * Cadence insert contract (ordered slots, max 8, add / remove / move /
 * bypass) and the structural references below.
 *
 * Structural references pulled from Mobbin (structure only; Mobbin has no
 * GarageBand, BandLab, Logic Remote, Koala or Ableton Note screens, so these
 * are the closest matches it returned):
 * - Apple Music, Playing Next queue: ordered rows with a per-row reorder affordance.
 * - [untitled], playlist detail: numbered track rows, a full-width "Add tracks" button above.
 * - TIDE, sound mix sheet: a short source list with per-source remove and an Add tile.
 * - Brink, Playback Effects: one row per effect with its on/off state at the trailing edge.
 */
import { useId, useRef } from "react";
import { Pressable, Text, View, type KeyDownEvent, type ViewProps } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { announce } from "@nyc-tron/ui/components/feedback/announce";
import { webToggleProps } from "@nyc-tron/ui/components/forms/toggle-a11y";
import {
  INSERT_KINDS, INSERT_KIND_LABELS, MAX_INSERTS, addBlockedReason, describeInsert, moveTarget,
  type InsertKind, type InsertSlot,
} from "./inserts.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

const HIT = 44;

/** Props for {@linkcode InsertEffectRack}. */
export interface InsertEffectRackProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Committed insert chain, first slot processes first. */
  readonly inserts: readonly InsertSlot[];
  /** Track or bus name, used in the heading and accessible names. */
  readonly label: string;
  /** Slot limit. @default MAX_INSERTS (8) */
  readonly maxInserts?: number;
  /** Slot whose parameters the app is showing, if any. */
  readonly selectedId?: string;
  /** Called when a slot is pressed, e.g. to open its editor or preset browser. */
  readonly onSelect?: ((id: string) => void) | undefined;
  /** Once per pick from the "Add effect" picker. The new slot goes at the end. */
  readonly onAdd: (kind: InsertKind) => void | Promise<unknown>;
  /** Once per remove button press, Delete key or screen-reader action. */
  readonly onRemove: (id: string) => void | Promise<unknown>;
  /**
   * Once per move button press, Alt+Arrow key or screen-reader action, with
   * the slot's requested index in the chain.
   */
  readonly onMove: (id: string, index: number) => void | Promise<unknown>;
  /**
   * Once per bypass toggle press with the requested state. The rack keeps
   * showing `inserts`, so a rejected promise leaves the old state visible.
   */
  readonly onBypassCommit: (id: string, bypassed: boolean) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  /** Drop the default token recipe; supply a full app recipe via `className`. */
  unstyled?: boolean;
}

/**
 * Controlled insert chain for one track or bus. Slots are listed in
 * processing order; each row has a bypass toggle, move earlier and move
 * later buttons (no drag), and remove. Keyboard on a slot: Alt+ArrowUp or
 * Alt+ArrowDown moves it, Delete or Backspace removes it, B toggles bypass.
 * Screen readers get the same as named actions.
 *
 * "Add effect" opens an inline picker of Gain, EQ and Compressor. When the
 * chain holds `maxInserts` slots the button is disabled and the reason is
 * shown under it.
 */
export function InsertEffectRack({scope='InsertEffectRack',revision=0,...props}:InsertEffectRackProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.label,props.disabled,props.disabledReason,props.inserts.map(p=>[p.id,p.kind]),props.maxInserts]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <InsertEffectRackBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onAdd={(...args:Parameters<InsertEffectRackProps['onAdd']>)=>guard.run('onAdd',h=>h.onAdd(...args))}
  onRemove={(...args:Parameters<InsertEffectRackProps['onRemove']>)=>guard.run('onRemove',h=>h.onRemove(...args))}
  onMove={(...args:Parameters<InsertEffectRackProps['onMove']>)=>guard.run('onMove',h=>h.onMove(...args))}
  onBypassCommit={(...args:Parameters<InsertEffectRackProps['onBypassCommit']>)=>guard.run('onBypassCommit',h=>h.onBypassCommit(...args))}
  onSelect={props.onSelect?(...args:Parameters<NonNullable<InsertEffectRackProps['onSelect']>>)=>{guard.current()?.onSelect?.(...args);}:undefined}
 />;
}
function InsertEffectRackBody({actionError,disabledReason,
  inserts, label, maxInserts = MAX_INSERTS, selectedId, onSelect, onAdd, onRemove, onMove, onBypassCommit,
  disabled = false, className, unstyled = false, ...rest
}: InsertEffectRackProps&{actionError?:string|null}) {
  if(!Number.isInteger(maxInserts)||maxInserts<1||maxInserts>256||inserts.length>maxInserts||new Set(inserts.map(v=>v.id)).size!==inserts.length||inserts.some(v=>!v.id.trim()||v.id.length>512||!INSERT_KINDS.includes(v.kind)))throw new RangeError('Invalid insert rack');
  const styled = !unstyled;
  const local = useRef<StoreApi<{ picking: boolean }> | null>(null);
  if (!local.current) local.current = createStore(() => ({ picking: false }));
  const store = local.current;
  const picking = useStore(store, s => s.picking);
  const reasonId = useId();
  const count = inserts.length;
  const blocked = addBlockedReason(count, maxInserts);
  const addDisabled = disabled || blocked !== undefined;
  const showPicker = picking && !addDisabled;

  const move = (slot: InsertSlot, index: number, direction: -1 | 1) => {
    const to = moveTarget(index, direction, count);
    if (to === undefined || disabled) return;
    void onMove(slot.id, to);
    announce(`${INSERT_KIND_LABELS[slot.kind]} moved to slot ${to + 1}`);
  };
  const add = (kind: InsertKind) => {
    store.setState({ picking: false });
    if (addDisabled) return;
    void onAdd(kind);
  };

  const heading = joinClasses(styled && "text-text font-semibold text-base");
  const muted = joinClasses(styled && "text-text-muted text-sm");
  return <View {...rest} accessibilityLabel={label + " inserts"} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised", className) }}
    style={[{ padding: tokens.spacing.fixedInset, gap: tokens.spacing.fixedInset }, rest.style]}>
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: tokens.spacing.fixedElement }}>
      <Text role="heading" {...{ "aria-level": 3 }} numberOfLines={1} style={{ flexShrink: 1 }} {...{ className: heading }}>
        {label + " inserts"}
      </Text>
      <Text {...{ className: muted }} style={{ fontVariant: ["tabular-nums"] }}>{`${count} of ${maxInserts}`}</Text>
    </View>

    {count === 0
      ? <View style={{ gap: tokens.spacing.fixedStack, paddingVertical: tokens.spacing.fixedElement }}>
          <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>No effects yet</Text>
          <Text {...{ className: muted }}>{`Add an effect to process ${label}. Effects run top to bottom.`}</Text>
        </View>
      : <View accessibilityLabel={label + " insert chain"} {...{ role: "list" }} style={{ gap: tokens.spacing.off6 }}>
          {inserts.map((slot, index) => <SlotRow key={slot.id} slot={slot} index={index} count={count}
            selected={slot.id === selectedId} disabled={disabled} styled={styled} trackLabel={label}
            onSelect={onSelect} onRemove={onRemove} onBypassCommit={onBypassCommit} move={move} />)}
        </View>}

    <View style={{ gap: tokens.spacing.fixedElement }}>
      <Pressable role="button" accessibilityLabel={"Add effect to " + label} disabled={addDisabled}
        accessibilityState={{ disabled: addDisabled, expanded: showPicker }}
        {...{ "aria-expanded": showPicker }}
        {...(blocked !== undefined ? { "aria-describedby": reasonId, accessibilityHint: blocked } : {})}
        onPress={() => store.setState({ picking: !picking })}
        {...{ className: joinClasses(styled && "rounded-control border border-border bg-surface-sunken items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80") }}
        style={{ minHeight: HIT, paddingHorizontal: tokens.spacing.fixedGroup, opacity: addDisabled ? tokens.opacity.disabled : 1 }}>
        <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>Add effect</Text>
      </Pressable>
      {blocked !== undefined ? <Text nativeID={reasonId} {...{ className: muted }}>{blocked}</Text> : null}
      {showPicker ? <View accessibilityLabel="Effect type" {...{ role: "group" }}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.off6 }}>
        {INSERT_KINDS.map(kind => <Pressable key={kind} role="button" accessibilityLabel={"Add " + INSERT_KIND_LABELS[kind]}
          onPress={() => add(kind)}
          onKeyDown={(e: KeyDownEvent) => { if (e.nativeEvent.key === "Escape") store.setState({ picking: false }); }}
          {...{ className: joinClasses(styled && "rounded-control border border-primary bg-surface-raised items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80") }}
          style={{ minHeight: HIT, minWidth: controlTokens.extent.field, paddingHorizontal: tokens.spacing.off14, flexGrow: 1 }}>
          <Text {...{ className: joinClasses(styled && "text-primary font-semibold") }}>{INSERT_KIND_LABELS[kind]}</Text>
        </Pressable>)}
      </View> : null}
    </View>
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}

type SlotRowProps = {
  slot: InsertSlot;
  index: number;
  count: number;
  selected: boolean;
  disabled: boolean;
  styled: boolean;
  trackLabel: string;
  onSelect?: ((id: string) => void) | undefined;
  onRemove: InsertEffectRackProps["onRemove"];
  onBypassCommit: InsertEffectRackProps["onBypassCommit"];
  move: (slot: InsertSlot, index: number, direction: -1 | 1) => void;
};

function SlotRow({ slot, index, count, selected, disabled, styled, onSelect, onRemove, onBypassCommit, move }: SlotRowProps) {
  const kind = INSERT_KIND_LABELS[slot.kind];
  const description = describeInsert(slot, index, count);
  const bypass = () => { if (!disabled) void onBypassCommit(slot.id, !slot.bypassed); };
  const remove = () => { if (!disabled) void onRemove(slot.id); };
  const onKeyDown = (e: KeyDownEvent) => {
    const { key, altKey } = e.nativeEvent as KeyDownEvent["nativeEvent"] & { altKey?: boolean };
    if (altKey && (key === "ArrowUp" || key === "ArrowDown")) { e.preventDefault(); move(slot, index, key === "ArrowUp" ? -1 : 1); }
    else if (key === "Delete" || key === "Backspace") { e.preventDefault(); remove(); }
    else if (key === "b" || key === "B") { e.preventDefault(); bypass(); }
  };
  const iconButton = joinClasses(styled && "rounded-control items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80");
  const first = index === 0;
  const last = index === count - 1;
  return <View {...{ role: "listitem" }}
    {...{ className: joinClasses(styled && "rounded-control border", styled && (selected ? "border-primary bg-surface-sunken" : "border-border bg-surface-raised")) }}
    style={{ flexDirection: "row", alignItems: "center", paddingStart: tokens.spacing.fixedStack, paddingEnd: tokens.spacing.off2, gap: tokens.spacing.off2, minHeight: HIT + tokens.spacing.fixedInset }}>
    <Pressable role="button" accessibilityLabel={description} accessibilityState={{ selected, disabled }}
      {...{ "aria-current": selected ? "true" : undefined }}
      accessibilityActions={[
        { name: "moveUp", label: "Move earlier" }, { name: "moveDown", label: "Move later" },
        { name: "bypass", label: slot.bypassed ? "Turn on" : "Bypass" }, { name: "remove", label: "Remove" },
      ]}
      onAccessibilityAction={e => {
        const name = e.nativeEvent.actionName;
        if (name === "moveUp") move(slot, index, -1);
        if (name === "moveDown") move(slot, index, 1);
        if (name === "bypass") bypass();
        if (name === "remove") remove();
      }}
      disabled={disabled} onPress={() => onSelect?.(slot.id)} onKeyDown={onKeyDown}
      {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
      style={{ flex: 1, minHeight: HIT, flexDirection: "row", alignItems: "center", gap: tokens.spacing.off10, paddingHorizontal: tokens.spacing.off6, opacity: disabled ? tokens.opacity.disabled : 1 }}>
      <Text {...{ className: joinClasses(styled && "text-text-muted text-sm") }}
        style={{ width: tokens.spacing.fixedGroup, textAlign: "center", fontVariant: ["tabular-nums"] }}>{String(index + 1)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} {...{ className: joinClasses(styled && "font-semibold", styled && (slot.bypassed ? "text-text-muted" : "text-text")) }}
          style={slot.bypassed ? { textDecorationLine: "line-through" } : undefined}>{kind}</Text>
        {slot.summary || slot.bypassed
          ? <Text numberOfLines={1} {...{ className: joinClasses(styled && "text-text-muted text-sm") }}>
              {[slot.bypassed ? "Bypassed" : undefined, slot.summary].filter(Boolean).join(", ")}
            </Text>
          : null}
      </View>
    </Pressable>
    <Pressable accessibilityRole="togglebutton" accessibilityLabel={"Bypass " + kind + " in slot " + (index + 1)}
      accessibilityState={{ checked: slot.bypassed, disabled }} {...webToggleProps(slot.bypassed)}
      disabled={disabled} onPress={bypass}
      {...{ className: joinClasses(iconButton, styled && "border", styled && (slot.bypassed ? "border-border bg-surface-sunken" : "border-accent bg-surface-raised")) }}
      style={{ width: HIT, height: HIT, opacity: disabled ? tokens.opacity.disabled : 1 }}>
      <PowerGlyph styled={styled} on={!slot.bypassed} />
    </Pressable>
    <Pressable role="button" accessibilityLabel={"Move " + kind + " earlier"} disabled={disabled || first}
      onPress={() => move(slot, index, -1)} {...{ className: iconButton }}
      style={{ width: HIT, height: HIT, opacity: disabled || first ? tokens.opacity.disabled : 1 }}>
      <ChevronGlyph styled={styled} up />
    </Pressable>
    <Pressable role="button" accessibilityLabel={"Move " + kind + " later"} disabled={disabled || last}
      onPress={() => move(slot, index, 1)} {...{ className: iconButton }}
      style={{ width: HIT, height: HIT, opacity: disabled || last ? tokens.opacity.disabled : 1 }}>
      <ChevronGlyph styled={styled} up={false} />
    </Pressable>
    <Pressable role="button" accessibilityLabel={"Remove " + kind + " from slot " + (index + 1)} disabled={disabled}
      onPress={remove} {...{ className: iconButton }} style={{ width: HIT, height: HIT, opacity: disabled ? tokens.opacity.disabled : 1 }}>
      <CloseGlyph styled={styled} />
    </Pressable>
  </View>;
}

const bar = { position: "absolute" as const, height: tokens.spacing.off2, borderRadius: forgeHairlineRadius.tick };

/** Chevron drawn with two rotated bars. */
function ChevronGlyph({ styled, up }: { styled: boolean; up: boolean }) {
  const cls = { className: joinClasses(styled && "bg-text") };
  const tilt = up ? 1 : -1;
  return <View pointerEvents="none" style={{ width: tokens.spacing.fixedGroup, height: tokens.spacing.off10 }}>
    <View {...cls} style={[bar, { width: tokens.spacing.off10, left: 0, top: tokens.spacing.fixedStack, transform: [{ rotate: `${-45 * tilt}deg` }] }]} />
    <View {...cls} style={[bar, { width: tokens.spacing.off10, left: tokens.spacing.off6, top: tokens.spacing.fixedStack, transform: [{ rotate: `${45 * tilt}deg` }] }]} />
  </View>;
}

/** Remove mark drawn with two rotated bars. */
function CloseGlyph({ styled }: { styled: boolean }) {
  const cls = { className: joinClasses(styled && "bg-text-muted") };
  return <View pointerEvents="none" style={{ width: tokens.spacing.off14, height: tokens.spacing.off14, alignItems: "center", justifyContent: "center" }}>
    <View {...cls} style={[bar, { width: tokens.spacing.off14, transform: [{ rotate: "45deg" }] }]} />
    <View {...cls} style={[bar, { width: tokens.spacing.off14, transform: [{ rotate: "-45deg" }] }]} />
  </View>;
}

/** Power mark: an open ring with a stem; filled accent when the effect runs. */
function PowerGlyph({ styled, on }: { styled: boolean; on: boolean }) {
  return <View pointerEvents="none" style={{ width: tokens.spacing.fixedGroup, height: tokens.spacing.fixedGroup, alignItems: "center" }}>
    <View style={{ position: "absolute", top: tokens.spacing.off2, width: tokens.spacing.off14, height: tokens.spacing.off14, borderRadius: forgeRadius.sm, borderWidth: tokens.borderWidth.strong }}
      {...{ className: joinClasses(styled && (on ? "border-accent" : "border-text-muted")) }} />
    <View style={{ position: "absolute", top: -tokens.borderWidth.hairline, width: tokens.spacing.off6, height: tokens.spacing.off6 }}
      {...{ className: joinClasses(styled && (on ? "bg-surface-raised" : "bg-surface-sunken")) }} />
    <View style={{ position: "absolute", top: 0, width: tokens.spacing.off2, height: tokens.spacing.fixedElement, borderRadius: forgeHairlineRadius.tick }}
      {...{ className: joinClasses(styled && (on ? "bg-accent" : "bg-text-muted")) }} />
  </View>;
}
