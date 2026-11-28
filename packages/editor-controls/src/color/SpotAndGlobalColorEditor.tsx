import { Text, TextInput, View, type ViewProps } from "react-native";
import { useRef } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { useOwnedAction } from "@nyc-tron/ui/components/shell/useOwnedAction";
import { ErrorMessage } from "@nyc-tron/ui/components/feedback/ErrorMessage";
import type { ChannelModel } from "./channel-fields.ts";
import { Button } from "@nyc-tron/ui/components/Button";
import { SegmentedControl } from "@nyc-tron/ui/components/SegmentedControl";
import { SettingSwitch } from "@nyc-tron/ui/components/forms/SettingSwitch";
import { UnitInput } from "@nyc-tron/ui/components/shell/UnitInput";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { validateNamedColor, type NamedColor } from "./color-management.ts";
import { ColorChannelFields } from "./ColorChannelFields.tsx";
import { rgbToHsv, hsvToRgb } from "../color.ts";
export type { NamedColor } from "./color-management.ts";
/** Controlled definition and explicit commit boundary for SpotAndGlobalColorEditor. */
export interface SpotAndGlobalColorEditorProps extends Omit<ViewProps, "children"> {
  readonly value: NamedColor;
  /** Draft changes; retain in a host-owned per-document store. */
  readonly onChange: (draft: NamedColor) => void;
  readonly onSave: (definition: NamedColor, signal: AbortSignal) => void | Promise<void>;
  readonly disabled?: boolean;
  readonly unstyled?: boolean;
}
/** Edits named spot/global identity, tint and an explicit sRGB alternate preview. */
export function SpotAndGlobalColorEditor({ value, onChange, onSave, disabled = false, unstyled = false, ...props }: SpotAndGlobalColorEditorProps) {
  const local = useRef<StoreApi<{ model: ChannelModel }> | null>(null);
  local.current ??= createStore(() => ({ model: "rgb" as ChannelModel }));
  const modelStore = local.current;
  const model = useStore(modelStore, state => state.model);
  const action = useOwnedAction(value.id);
  const pending = action.pending !== null;
  const locked = disabled || pending;
  // Empty draft names remain editable; only Save requires a nonempty name.
  validateNamedColor({ ...value, name: value.name.trim() ? value.name : "Untitled" });
  return <View {...props} style={[{ gap: 8 }, props.style]}>
    <Text {...{ className: joinClasses(!unstyled && "text-text") }}>Color name</Text>
    <TextInput accessibilityLabel="Color name" value={value.name} editable={!locked} maxLength={256} onChangeText={name => { if (!locked) onChange({ ...value, name }); }} style={{ minHeight: 44, padding: 8 }} {...{ className: joinClasses(!unstyled && "border border-border rounded-control bg-surface-sunken text-text") }}/>
    <SegmentedControl aria-label="Named color kind" value={value.kind} options={[{ value: "spot", label: "Spot ink" }, { value: "global", label: "Global color" }]} disabled={locked} unstyled={unstyled} onChange={kind => { if (!locked) onChange({ ...value, kind }); }}/>
    <SettingSwitch label="Overprint named color" on={value.overprint??false} onChange={overprint=>{if(!locked)onChange({...value,overprint});}} disabled={locked} styled={!unstyled}/>
    <UnitInput label="Ink tint percent" value={value.tint} min={0} max={100} disabled={locked} unstyled={unstyled} onCommit={tint => { if (!locked) onChange({ ...value, tint }); }}/>
    <ColorChannelFields value={rgbToHsv(value.alternate)} model={model} onModelChange={model => modelStore.setState({ model })} disabled={locked} unstyled={unstyled} onCommit={color => { if (!locked) onChange({ ...value, alternate: hsvToRgb(color) }); }}/>
    <Text {...{ className: joinClasses(!unstyled && "text-text-muted") }}>Alternate preview is sRGB. The host retains ink separation and output profiles.</Text>
    {pending ? <Button title="Cancel color save" unstyled={unstyled} onPress={action.cancel}/> : null}
    <ErrorMessage {...(action.error ? { message: action.error } : {})} unstyled={unstyled}/>
    <Button title="Save named color" disabled={locked || !value.name.trim()} unstyled={unstyled} onPress={() => { if (locked) return; validateNamedColor(value); void action.run("save", signal => onSave(value, signal)); }}/>
  </View>;
}
