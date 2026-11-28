import {View,type ViewProps} from 'react-native';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {TONE_FIELDS,validateTone,type ToneSettings} from './photo-adjustments.ts';
export type {ToneSettings} from './photo-adjustments.ts';
export interface ToneAndPresenceProps extends Omit<ViewProps,'children'> {readonly value:ToneSettings;readonly onCommit:(value:ToneSettings)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Controlled non-destructive tone settings. The host owns the image transform. */
export function ToneAndPresence({value,onCommit,disabled=false,unstyled=false,...props}:ToneAndPresenceProps){
 validateTone(value);
 return <View {...props} style={[{gap:8},props.style]}>{TONE_FIELDS.map(([key,label,min,max,step])=><UnitInput key={key} label={label} value={value[key]} min={min} max={max} step={step} precision={2} disabled={disabled} unstyled={unstyled} onCommit={number=>{if(disabled||number===value[key])return;const next={...value,[key]:number};validateTone(next);onCommit(next);}}/>)}</View>;
}
