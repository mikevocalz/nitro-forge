import {Text,View,type ViewProps} from 'react-native';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export type EraserMode='pixel'|'vector'|'mask'|'object';
export interface EraserCapability {mode:EraserMode;available:boolean;reason?:string}
export interface EraserModePickerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:EraserMode;capabilities:readonly EraserCapability[];onChange:(mode:EraserMode,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
const MODES=[{value:'pixel',label:'Pixel'},{value:'vector',label:'Vector'},{value:'mask',label:'Mask'},{value:'object',label:'Object'}] as const;
export function EraserModePicker({scope='eraser',revision=0,...props}:EraserModePickerProps){
 const {value,capabilities,onChange:_change,unstyled=false,disabledReason,style,...rest}=props;
 if(!MODES.some(m=>m.value===value)||capabilities.length>4||new Set(capabilities.map(c=>c.mode)).size!==capabilities.length||capabilities.some(c=>!MODES.some(m=>m.value===c.mode)||!c.available&&!c.reason?.trim()))throw new RangeError('Invalid eraser capabilities');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason,capabilities]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]} accessibilityLabel="Eraser mode">
  <SegmentedControl aria-label="Eraser mode" value={value} disabled={off} unstyled={unstyled} options={MODES.map(m=>({...m,disabled:!capabilities.find(c=>c.mode===m.value)?.available}))}
   onChange={mode=>guard.run('mode',(host,signal)=>host.capabilities.find(c=>c.mode===mode)?.available?host.onChange(mode,signal):undefined)}/>
  {MODES.filter(m=>!capabilities.find(c=>c.mode===m.value)?.available).map(m=><Text {...{className:unstyled?undefined:'text-text'}} key={m.value}>{m.label}: {capabilities.find(c=>c.mode===m.value)?.reason??'Not supported by the current document'}</Text>)}
  {off?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Changing eraser'}</Text>:null}
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
