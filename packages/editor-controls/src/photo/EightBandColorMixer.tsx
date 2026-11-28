import {View,Text,type ViewProps} from 'react-native';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {PHOTO_BANDS,validateEightBand,type EightBandSettings} from './photo-adjustments.ts';
import { tokens } from '../tokens.ts';
export type {EightBandSettings,PhotoBand,BandAdjustment} from './photo-adjustments.ts';
export interface EightBandColorMixerProps extends Omit<ViewProps,'children'> {readonly value:EightBandSettings;readonly onCommit:(value:EightBandSettings)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Eight explicit color ranges; edits retain every other band's exact values. */
export function EightBandColorMixer({value,onCommit,disabled=false,unstyled=false,...props}:EightBandColorMixerProps){
 validateEightBand(value);
 return <View {...props} style={[{gap:tokens.spacing.fixedInset},props.style]}>{PHOTO_BANDS.map(band=><View key={band} style={{gap:tokens.spacing.off6}}>
  <Text accessibilityRole="header" {...{className:joinClasses(!unstyled&&'text-text')}}>{band}</Text>
  {(['hue','saturation','luminance'] as const).map(channel=><UnitInput key={channel} label={`${band} ${channel}`} value={value[band][channel]} min={-100} max={100} step={1} disabled={disabled} unstyled={unstyled} onCommit={number=>{if(disabled||number===value[band][channel])return;const next={...value,[band]:{...value[band],[channel]:number}};validateEightBand(next);onCommit(next);}}/>)}</View>)}</View>;
}
