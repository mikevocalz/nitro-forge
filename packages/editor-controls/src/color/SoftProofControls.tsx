import { View, type ViewProps } from "react-native";
import { Select } from "@nyc-tron/ui/components/Select";
import { SettingSwitch } from "@nyc-tron/ui/components/forms/SettingSwitch";
import { validateSoftProof, type ColorProfile, type SoftProofSettings } from "./color-management.ts";
import { tokens } from "../tokens.ts";
export type { SoftProofSettings } from "./color-management.ts";
/** Explicit output proof configuration rendered by SoftProofControls. */
export interface SoftProofControlsProps extends Omit<ViewProps, "children"> {
  readonly value: SoftProofSettings;
  readonly profiles: readonly ColorProfile[];
  readonly onCommit: (settings: SoftProofSettings) => void;
  readonly disabled?: boolean;
  readonly unstyled?: boolean;
}
/** Controls a host's proof transform; UI does not pretend to perform ICC conversion. */
export function SoftProofControls({ value, profiles, onCommit, disabled = false, unstyled = false, ...props }: SoftProofControlsProps) {
  validateSoftProof(value, profiles);
  const set = (change: Partial<SoftProofSettings>) => { if (disabled) return; const next = { ...value, ...change }; validateSoftProof(next, profiles); onCommit(next); };
  return <View {...props} style={[{ gap: tokens.spacing.fixedElement }, props.style]}>
    <Select label="Proof output profile" value={value.profileId ?? ""} placeholder="Choose a proof profile" options={profiles.map(profile => ({ value: profile.id, label: profile.label }))} disabled={disabled} unstyled={unstyled} onValueChange={profileId => set({ profileId })}/>
    <SettingSwitch label="Enable soft proof" on={value.enabled} onChange={enabled => set({ enabled })} disabled={disabled || value.profileId === null} styled={!unstyled}/>
    <Select label="Rendering intent" value={value.intent} options={(["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"] as const).map(value => ({ value, label: value.replaceAll("-", " ") }))} disabled={disabled} unstyled={unstyled} onValueChange={intent => set({ intent: intent as SoftProofSettings["intent"] })}/>
    <SettingSwitch label="Show proof gamut clipping" on={value.showGamutClipping??false} onChange={showGamutClipping=>set({showGamutClipping})} disabled={disabled} styled={!unstyled}/>
    {([['blackPointCompensation', 'Black point compensation'], ['simulatePaper', 'Simulate paper color'], ['simulateBlackInk', 'Simulate black ink']] as const).map(([key, label]) => <SettingSwitch key={key} label={label} on={value[key]} onChange={on => set({ [key]: on })} disabled={disabled} styled={!unstyled}/>)}
  </View>;
}
