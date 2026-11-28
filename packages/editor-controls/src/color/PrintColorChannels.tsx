import { View, type ViewProps } from "react-native";
import { Select } from "@nyc-tron/ui/components/Select";
import { UnitInput } from "@nyc-tron/ui/components/shell/UnitInput";
import { validatePrintColor, type PrintColor, type ColorConversionPolicy } from "./color-management.ts";
export type { PrintColor } from "./color-management.ts";
/** Controlled, profile-preserving CMYK/Lab editor; every field acceptance commits one change. */
export interface PrintColorChannelsProps extends Omit<ViewProps, "children"> {
  readonly value: PrintColor;
  readonly onCommit: (value: PrintColor) => void;
  /** Profile policy is requested, never approximated by this UI. @default preserve-numbers */
  readonly conversionPolicy?: ColorConversionPolicy;
  readonly onConversionPolicyChange?: (policy: ColorConversionPolicy) => void;
  /** Editable a-star/b-star bounds selected by the host profile. @default [-128,127] */
  readonly labRange?: readonly [number,number];
  readonly disabled?: boolean;
  readonly unstyled?: boolean;
}
/** Edits actual CMYK percentages or signed Lab channels without approximating ICC conversion from RGB. */
export function PrintColorChannels({ value, onCommit, conversionPolicy = "preserve-numbers", onConversionPolicyChange, labRange = [-128,127], disabled = false, unstyled = false, ...props }: PrintColorChannelsProps) {
  validatePrintColor(value,labRange);
  if(!["preserve-numbers","preserve-appearance"].includes(conversionPolicy))throw new TypeError("Unknown color conversion policy");
  const labels=value.model==='lab'?["Lightness L*","Lab a*","Lab b*"]:["Cyan percent","Magenta percent","Yellow percent","Black percent"];
  return <View {...props} style={[{ gap: 8 }, props.style]}>
    <Select label="Print conversion policy" value={conversionPolicy} options={[{value:"preserve-numbers",label:"Preserve channel numbers"},{value:"preserve-appearance",label:"Preserve color appearance"}]} disabled={disabled||!onConversionPolicyChange} unstyled={unstyled} onValueChange={policy=>onConversionPolicyChange?.(policy as ColorConversionPolicy)}/>
    {labels.map((label, index) => <UnitInput key={label} label={label} value={value.channels[index]!} min={value.model==='lab'&&index>0?labRange[0]:0} max={value.model==='lab'&&index>0?labRange[1]:100} step={1} precision={2} disabled={disabled} unstyled={unstyled}
      onCommit={number => { if (disabled || number === value.channels[index]) return; const channels = [...value.channels] as PrintColor["channels"] & number[]; channels[index] = number; onCommit({ ...value, channels }); }}/>) }
    <UnitInput label="Print opacity percent" value={value.alpha * 100} min={0} max={100} step={1} disabled={disabled} unstyled={unstyled} onCommit={alpha => { if (!disabled && alpha / 100 !== value.alpha) onCommit({ ...value, alpha: alpha / 100 }); }}/>
  </View>;
}
