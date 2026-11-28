import { View, type ViewProps } from "react-native";
import { UnitInput } from "@nyc-tron/ui/components/shell/UnitInput";
import { validateLevels, type ColorLevels } from "./color-adjustments.ts";
export type { ColorLevels } from "./color-adjustments.ts";
/** Controlled per-channel levels; select the channel in the consuming app. */
export interface LevelsEditorProps extends Omit<ViewProps,"children"> {
  readonly value: ColorLevels;
  readonly onCommit: (value: ColorLevels) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly unstyled?: boolean;
}
/** Edits input/output bounds and gamma with noncrossing constraints. */
export function LevelsEditor({value,onCommit,label="Levels",disabled=false,unstyled=false,...props}:LevelsEditorProps){
  validateLevels(value);
  const fields=[['inputBlack','Input black',0,value.inputWhite-1e-6],['inputWhite','Input white',value.inputBlack+1e-6,1],['gamma','Gamma',.1,10],['outputBlack','Output black',0,value.outputWhite],['outputWhite','Output white',value.outputBlack,1]] as const;
  return <View {...props} style={[{gap:8},props.style]}>{fields.map(([key,name,min,max])=><UnitInput key={key} label={`${label} ${name}`} value={value[key]} min={min} max={max} step={.01} precision={6} disabled={disabled} unstyled={unstyled} onCommit={number=>{if(disabled||number===value[key])return;const next={...value,[key]:number};validateLevels(next);onCommit(next);}}/>)}</View>;
}
