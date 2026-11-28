import { View, type ViewProps } from "react-native";
import { UnitInput } from "@nyc-tron/ui/components/shell/UnitInput";
import { validateColorChannels, type WideGamutColor } from "./color-management.ts";
export type { WideGamutColor } from "./color-management.ts";
/** Floating channel editor retaining profile identity and out-of-display-range values. */
export interface WideGamutChannelsProps extends Omit<ViewProps, "children"> {
  readonly value: WideGamutColor;
  readonly onCommit: (value: WideGamutColor) => void;
  /** Host profile's editable channel range, including negative/HDR values where applicable. @default -16 */
  readonly min?: number;
  /** @default 16 */
  readonly max?: number;
  readonly disabled?: boolean;
  readonly unstyled?: boolean;
}
/** Edits floating RGB without quantizing to bytes, clipping to sRGB or guessing a transfer function. */
export function WideGamutChannels({ value, onCommit, min = -16, max = 16, disabled = false, unstyled = false, ...props }: WideGamutChannelsProps) {
  validateColorChannels(value, 3, min, max);
  return <View {...props} style={[{ gap: 8 }, props.style]}>
    {(["Red", "Green", "Blue"] as const).map((label, index) => <UnitInput key={label} label={`${label} floating channel`} value={value.channels[index]!} min={min} max={max} step={.01} precision={6} disabled={disabled} unstyled={unstyled}
      onCommit={number => { if (disabled || number === value.channels[index]) return; const channels = [...value.channels] as [number, number, number]; channels[index] = number; onCommit({ ...value, channels }); }}/>) }
    <UnitInput label="Wide gamut opacity" value={value.alpha} min={0} max={1} step={.01} precision={4} disabled={disabled} unstyled={unstyled} onCommit={alpha => { if (!disabled && alpha !== value.alpha) onCommit({ ...value, alpha }); }}/>
  </View>;
}
