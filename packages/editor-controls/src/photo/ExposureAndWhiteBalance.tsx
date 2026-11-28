import {View,type ViewProps} from 'react-native';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {EXPOSURE_FIELDS,validateExposure,type ExposureSettings} from './photo-adjustments.ts';
import { tokens } from '../tokens.ts';
export type {ExposureSettings} from './photo-adjustments.ts';
export interface ExposureAndWhiteBalanceProps extends Omit<ViewProps,'children'> {readonly value:ExposureSettings;readonly onCommit:(value:ExposureSettings)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Controlled non-destructive exposure settings. The host owns the image transform. */
export function ExposureAndWhiteBalance({value,onCommit,disabled=false,unstyled=false,...props}:ExposureAndWhiteBalanceProps){
 validateExposure(value);
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>{EXPOSURE_FIELDS.map(([key,label,min,max,step])=><UnitInput key={key} label={label} value={value[key]} min={min} max={max} step={step} precision={2} disabled={disabled} unstyled={unstyled} onCommit={number=>{if(disabled||number===value[key])return;const next={...value,[key]:number};validateExposure(next);onCommit(next);}}/>)}</View>;
}
