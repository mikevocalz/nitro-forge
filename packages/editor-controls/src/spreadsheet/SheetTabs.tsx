import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { useRef } from "react";
import { I18nManager, Pressable, ScrollView, Text, TextInput, View, type ViewProps } from "react-native";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {
  SHEET_TAB_TONES, sheetNameError, sheetTabKeyTarget, sheetTabMoveIndex,
  type SheetTab, type SheetTabTone,
} from "./sheet-tabs-model.ts";
import {exact} from '../exact-optional.ts';

/**
 * Controlled worksheet tab strip. The app owns the workbook (for Forge, the
 * Tally engine) and passes the tabs back after each change. Every action
 * appears only when its callback is supplied, so an engine that cannot
 * duplicate or reorder sheets never shows those commands.
 */
export interface SheetTabsProps extends Omit<ViewProps, "children">,ScopedControlProps {
  readonly tabs: readonly SheetTab[];
  readonly activeId: string;
  readonly onSelect: (id: string) => unknown;
  readonly onAdd?: (() => unknown) | undefined;
  /** Called with a name that passed {@linkcode sheetNameError}; reject to show the engine's message. */
  readonly onRename?: ((id: string, name: string) => unknown) | undefined;
  readonly onDuplicate?: ((id: string) => unknown) | undefined;
  /** Move a tab to `toIndex` in the current order. */
  readonly onMove?: ((id: string, toIndex: number) => unknown) | undefined;
  /** Never offered for the last remaining sheet. */
  readonly onRemove?: ((id: string) => unknown) | undefined;
  readonly onProtectedChange?: ((id: string, isProtected: boolean) => unknown) | undefined;
  readonly onToneChange?: ((id: string, tone: SheetTabTone | undefined) => unknown) | undefined;
  /** Reading direction for arrow keys. @default I18nManager.isRTL */
  readonly direction?: "ltr" | "rtl";
  readonly disabled?:boolean;
  readonly className?: string;
  readonly unstyled?: boolean;
}

type Local = {
  renaming: string | undefined; draft: string; actionsOpen: boolean;
  confirmRemove: boolean; pending: boolean; error: string | null;
};

const stripe: Record<SheetTabTone, string> = {
  primary: "border-b-primary", accent: "border-b-accent", success: "border-b-success",
  info: "border-b-info", muted: "border-b-text-muted",
};
const swatch: Record<SheetTabTone, string> = {
  primary: "bg-primary", accent: "bg-accent", success: "bg-success", info: "bg-info", muted: "bg-text-muted",
};
const toneName: Record<SheetTabTone, string> = {
  primary: "Blue", accent: "Teal", success: "Green", info: "Navy", muted: "Gray",
};

/** A padlock drawn with views, so forced colors and every platform keep it. */
function LockMark({ unstyled }: { unstyled: boolean }) {
  const line = !unstyled ? "border-text-muted" : undefined;
  return <View aria-hidden style={{ width: 10, height: 12, alignItems: "center" }}>
    <View {...{ className: line }} style={{ width: 6, height: 6, borderWidth: 1.5, borderBottomWidth: 0, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
    <View {...{ className: !unstyled ? "bg-text-muted" : undefined }} style={{ width: 10, height: 6, borderRadius: 1 }} />
  </View>;
}

function ActionButton({ label, text, onPress, disabled, unstyled, hint }: {
  label: string; text?: string; onPress: () => void; disabled?: boolean; unstyled: boolean; hint?: string | undefined;
}) {
  return <Pressable role="button" accessibilityLabel={label} accessibilityHint={hint}
    aria-disabled={disabled} disabled={disabled} onPress={onPress}
    {...{ className: joinClasses(!unstyled && "rounded-control border border-border bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus",
      !unstyled && disabled && "opacity-50") }}
    style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: "center" }}>
    <Text {...{ className: !unstyled ? "text-text" : undefined }}>{text ?? label}</Text>
  </Pressable>;
}

export function SheetTabs({scope='SheetTabs',revision=0,...props}:SheetTabsProps){
 if(props.tabs.length>4096||new Set(props.tabs.map(t=>t.id)).size!==props.tabs.length||props.tabs.some(t=>!t.id.trim()||t.id.length>256||!t.name.trim()||t.name.length>64))throw new RangeError('Invalid worksheet tabs');
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=JSON.stringify([identity,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <SheetTabsBody key={identity} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSelect={async(...args:Parameters<NonNullable<SheetTabsProps['onSelect']>>)=>{const ok=await guard.run('onSelect',h=>h.onSelect?.(...args));if(ok!==true)throw new Error('Sheet change did not complete');}}
  onAdd={props.onAdd?async(...args:Parameters<NonNullable<SheetTabsProps['onAdd']>>)=>{const ok=await guard.run('onAdd',h=>h.onAdd?.(...args));if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
  onRename={props.onRename?async(...args:Parameters<NonNullable<SheetTabsProps['onRename']>>)=>{const ok=await guard.run('onRename',h=>{if(!h.tabs.some(t=>t.id===args[0]&&!t.isProtected))throw new Error('This sheet cannot be renamed');return h.onRename?.(...args);});if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
  onDuplicate={props.onDuplicate?async(...args:Parameters<NonNullable<SheetTabsProps['onDuplicate']>>)=>{const ok=await guard.run('onDuplicate',h=>h.onDuplicate?.(...args));if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
  onMove={props.onMove?async(...args:Parameters<NonNullable<SheetTabsProps['onMove']>>)=>{const ok=await guard.run('onMove',h=>{if(!h.tabs.some(t=>t.id===args[0]&&!t.isProtected)||!Number.isInteger(args[1])||args[1]<0||args[1]>=h.tabs.length)throw new Error('This sheet cannot be reordered');return h.onMove?.(...args);});if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
  onRemove={props.onRemove?async(...args:Parameters<NonNullable<SheetTabsProps['onRemove']>>)=>{const ok=await guard.run('onRemove',h=>{if(h.tabs.length<2||!h.tabs.some(t=>t.id===args[0]&&!t.isProtected))throw new Error('This sheet cannot be removed');return h.onRemove?.(...args);});if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
  onProtectedChange={props.onProtectedChange?async(...args:Parameters<NonNullable<SheetTabsProps['onProtectedChange']>>)=>{const ok=await guard.run('onProtectedChange',h=>h.onProtectedChange?.(...args));if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
  onToneChange={props.onToneChange?async(...args:Parameters<NonNullable<SheetTabsProps['onToneChange']>>)=>{const ok=await guard.run('onToneChange',h=>h.onToneChange?.(...args));if(ok!==true)throw new Error('Sheet change did not complete');}:undefined}
 />;
}
function SheetTabsBody({actionError,disabledReason,disabled=false,
  tabs, activeId, onSelect, onAdd, onRename, onDuplicate, onMove, onRemove,
  onProtectedChange, onToneChange, direction, className, unstyled = false, ...props
}: SheetTabsProps&{actionError?:string|null}) {
  const storeRef = useRef<StoreApi<Local> | null>(null);
  if (!storeRef.current) storeRef.current = createStore<Local>(() => ({
    renaming: undefined, draft: "", actionsOpen: false, confirmRemove: false, pending: false, error: null,
  }));
  const store = storeRef.current;
  const renaming = useStore(store, s => s.renaming);
  const draft = useStore(store, s => s.draft);
  const actionsOpen = useStore(store, s => s.actionsOpen);
  const confirmRemove = useStore(store, s => s.confirmRemove);
  const pending = useStore(store, s => s.pending)||disabled;
  const error = useStore(store, s => s.error);
  const tabRefs = useRef(new Map<string, { focus?: () => void }>());
  const rtl = direction ? direction === "rtl" : I18nManager.isRTL;
  const active = tabs.find(tab => tab.id === activeId);
  const locked = active?.isProtected === true;

  // One action at a time; a rejected promise becomes the visible error.
  const run = async (action: () => unknown, after?: Partial<Local>) => {
    if (store.getState().pending||disabled) return;
    store.setState({ pending: true, error: null });
    try {
      await action();
      store.setState({ ...after });
    } catch (e) {
      store.setState({ error: e instanceof Error ? e.message : "That sheet change didn't go through." });
    } finally {
      store.setState({ pending: false });
    }
  };
  const startRename = (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab || !onRename || tab.isProtected) return;
    store.setState({ renaming: id, draft: tab.name, error: null, confirmRemove: false });
  };
  const submitRename = () => {
    const { renaming: id, draft: name } = store.getState();
    if (id === undefined) return;
    const tab = tabs.find(t => t.id === id);
    if (tab && tab.name === name.trim()) { store.setState({ renaming: undefined }); return; }
    const problem = sheetNameError(name, tabs, id);
    if (problem) { store.setState({ error: problem }); return; }
    void run(() => onRename!(id, name.trim()), { renaming: undefined });
  };
  const select = (id: string) => {
    if (id === activeId) return;
    store.setState({ confirmRemove: false });
    void run(() => onSelect(id));
  };
  const onKeyDown = (e: { nativeEvent: { key: string; ctrlKey?: boolean; metaKey?: boolean }; preventDefault?: () => void }) => {
    const n = e.nativeEvent;
    if (store.getState().renaming !== undefined) {
      if (n.key === "Escape") { store.setState({ renaming: undefined, error: null }); e.preventDefault?.(); }
      return;
    }
    if (n.key === "F2") { startRename(activeId); e.preventDefault?.(); return; }
    const key = n.key === "PageDown" && (n.ctrlKey || n.metaKey) ? (rtl ? "ArrowLeft" : "ArrowRight")
      : n.key === "PageUp" && (n.ctrlKey || n.metaKey) ? (rtl ? "ArrowRight" : "ArrowLeft") : n.key;
    const target = sheetTabKeyTarget(tabs, activeId, key, rtl);
    if (target === undefined) return;
    e.preventDefault?.();
    select(target);
    tabRefs.current.get(target)?.focus?.();
  };

  const textClass = !unstyled ? "text-text" : undefined;
  const mutedClass = !unstyled ? "text-text-muted" : undefined;
  const hasActions = Boolean(onRename || onDuplicate || onMove || onRemove || onProtectedChange || onToneChange);
  const activeIndex = tabs.findIndex(tab => tab.id === activeId);
  const back = active ? sheetTabMoveIndex(tabs, active.id, -1) : undefined;
  const forward = active ? sheetTabMoveIndex(tabs, active.id, 1) : undefined;

  return <View {...props} {...{ className: joinClasses(!unstyled && "border-t border-border bg-surface-sunken", className) }}>
    <View style={{ flexDirection: "row", alignItems: "stretch" }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
        contentContainerStyle={{ flexDirection: "row", alignItems: "stretch" }}>
        <View role="tablist" aria-label="Sheets" onKeyDown={onKeyDown as never} style={{ flexDirection: "row" }}>
          {tabs.map(tab => {
            const selected = tab.id === activeId;
            if (renaming === tab.id) {
              return <TextInput key={tab.id} autoFocus value={draft} maxLength={64}
                accessibilityLabel={`Rename sheet ${tab.name}`}
                onChangeText={next => store.setState({ draft: next, error: null })}
                onSubmitEditing={submitRename}
                onBlur={() => { if (store.getState().renaming === tab.id && !store.getState().pending) submitRename(); }}
                {...{ className: joinClasses(!unstyled && "rounded-control border border-focus bg-surface-raised text-text") }}
                style={{ minHeight: 44, minWidth: 120, paddingHorizontal: 12, marginHorizontal: 4 }} />;
            }
            return <Pressable key={tab.id} role="tab" aria-selected={selected}
              ref={node => { if (node) tabRefs.current.set(tab.id, node as never); else tabRefs.current.delete(tab.id); }}
              accessibilityLabel={`${tab.name}${tab.isProtected ? ", protected" : ""}`}
              accessibilityHint={onRename && !tab.isProtected ? "Double tap and hold, or press F2, to rename" : undefined}
              onPress={() => select(tab.id)}
              onLongPress={() => startRename(tab.id)}
              {...{ className: joinClasses(
                !unstyled && "border-e border-border focus-visible:ring-2 focus-visible:ring-focus",
                !unstyled && (selected ? "bg-surface-raised" : "bg-transparent"),
                !unstyled && tab.tone && "border-b-[3px]", !unstyled && tab.tone && stripe[tab.tone],
              ) }}
              style={{ minHeight: 44, minWidth: 64, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 6 }}>
              {tab.isProtected ? <LockMark unstyled={unstyled} /> : null}
              <Text numberOfLines={1} {...{ className: joinClasses(selected ? textClass : mutedClass, selected && "font-semibold") }}>
                {tab.name}
              </Text>
            </Pressable>;
          })}
        </View>
      </ScrollView>
      {onAdd ? <ActionButton unstyled={unstyled} label="New sheet" text="New" disabled={pending}
        onPress={() => void run(() => onAdd())} /> : null}
      {hasActions ? <Pressable role="button" aria-expanded={actionsOpen} accessibilityLabel={actionsOpen ? "Done editing sheet" : "Edit sheet"}
        onPress={() => store.setState(s => ({ actionsOpen: !s.actionsOpen, confirmRemove: false }))}
        {...{ className: joinClasses(!unstyled && "border-s border-border focus-visible:ring-2 focus-visible:ring-focus",
          !unstyled && actionsOpen && "bg-surface-raised") }}
        style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: "center" }}>
        <Text {...{ className: textClass }}>{actionsOpen ? "Done" : "Edit"}</Text>
      </Pressable> : null}
    </View>
    {actionsOpen && active ? <View role="toolbar" aria-label={`Actions for ${active.name}`}
      {...{ className: joinClasses(!unstyled && "border-t border-border bg-surface-raised") }}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8 }}>
      {onRename && !locked ? <ActionButton unstyled={unstyled} label="Rename" disabled={pending} onPress={() => startRename(active.id)} /> : null}
      {onDuplicate ? <ActionButton unstyled={unstyled} label="Duplicate" disabled={pending} onPress={() => void run(() => onDuplicate(active.id))} /> : null}
      {onMove && !locked ? <>
        <ActionButton unstyled={unstyled} label={rtl ? "Move right" : "Move left"} disabled={pending || back === undefined}
          onPress={() => back !== undefined && void run(() => onMove(active.id, back))} />
        <ActionButton unstyled={unstyled} label={rtl ? "Move left" : "Move right"} disabled={pending || forward === undefined}
          onPress={() => forward !== undefined && void run(() => onMove(active.id, forward))} />
      </> : null}
      {onProtectedChange ? <ActionButton unstyled={unstyled} label={locked ? "Unprotect" : "Protect"} disabled={pending}
        onPress={() => void run(() => onProtectedChange(active.id, !locked))} /> : null}
      {onRemove && !locked ? (confirmRemove
        ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text {...{ className: textClass }}>{`Remove ${active.name}?`}</Text>
          <ActionButton unstyled={unstyled} label="Remove" disabled={pending}
            onPress={() => void run(() => onRemove(active.id), { confirmRemove: false })} />
          <ActionButton unstyled={unstyled} label="Keep" onPress={() => store.setState({ confirmRemove: false })} />
        </View>
        : <ActionButton unstyled={unstyled} label="Remove" disabled={pending || tabs.length <= 1}
          hint={tabs.length <= 1 ? "A workbook keeps at least one sheet" : undefined}
          onPress={() => store.setState({ confirmRemove: true })} />) : null}
      {locked && (onRename || onRemove || onMove) ? <Text {...{ className: mutedClass }} style={{ alignSelf: "center" }}>
        Unprotect this sheet to rename, move or remove it.
      </Text> : null}
      {onToneChange ? <View role="radiogroup" aria-label="Tab color" style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
        {[undefined, ...SHEET_TAB_TONES].map(tone => {
          const checked = active.tone === tone;
          return <Pressable key={tone ?? "none"} role="radio" aria-checked={checked}
            accessibilityLabel={tone ? toneName[tone] : "No color"} disabled={pending}
            onPress={() => void run(() => onToneChange(active.id, tone))}
            {...{ className: joinClasses(!unstyled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus",
              !unstyled && checked && "border-2 border-focus") }}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <View {...{ className: joinClasses(!unstyled && (tone ? swatch[tone] : "border border-border bg-surface-sunken")) }}
              style={{ width: 20, height: 20, borderRadius: 10 }} />
          </Pressable>;
        })}
      </View> : null}
    </View> : null}
    {activeIndex < 0 && tabs.length > 0 ? <Text {...{ className: mutedClass }} style={{ paddingHorizontal: 12 }}>
      No sheet is selected.
    </Text> : null}
  <ErrorMessage {...exact({message:actionError??error??disabledReason,unstyled:unstyled})}/></View>;
}
