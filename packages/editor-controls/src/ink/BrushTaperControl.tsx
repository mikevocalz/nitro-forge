import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {validateBrushTaper,type BrushTaper,type BrushTaperSettings} from './brush-model.ts';
export interface BrushTaperControlProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:BrushTaperSettings;input:'pen'|'touch';onInputChange:(input:'pen'|'touch')=>void;
 onCommit:(settings:BrushTaperSettings,signal?:AbortSignal)=>void|Promise<unknown>;
 /** Whether the active pen/touch adapter supplies pressure, rather than simulated force. */
 pressureAvailable:boolean;
 /** Host brush renderer's live test pad, using the requested input settings. */
 renderTestStroke:(settings:BrushTaper,input:'pen'|'touch')=>ReactNode;unstyled?:boolean;
}
export function BrushTaperControl({scope='brush-taper',revision=0,...props}:BrushTaperControlProps){
 const {value,input,onInputChange:_input,onCommit:_commit,pressureAvailable,renderTestStroke,unstyled=false,disabledReason,style,...rest}=props;validateBrushTaper(value);
 if(!['pen','touch'].includes(input))throw new RangeError('Unknown taper input');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),input,disabledReason,pressureAvailable]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined,taper=value[input];
 const set=(patch:Partial<BrushTaper>)=>guard.run('taper',(host,signal)=>host.onCommit({...host.value,[host.input]:{...host.value[host.input],...patch}},signal));
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Brush taper">
  <SegmentedControl aria-label="Taper input" value={input} options={[{value:'pen',label:'Pen'},{value:'touch',label:'Touch'}]} disabled={off} unstyled={unstyled} onChange={next=>guard.current()?.onInputChange(next)}/>
  {(['start','end','minimumSize'] as const).map(key=><PrecisionScrubber key={key} scope={scope} revision={revision} label={key==='start'?'Start taper':key==='end'?'End taper':'Minimum tip size'} value={taper[key]} min={0} max={1} step={.01} disabled={off} unstyled={unstyled} onCommit={n=>set({[key]:n})}/>)}
  <SegmentedControl aria-label="Tip shape" value={taper.tip} options={[{value:'round',label:'Round'},{value:'linear',label:'Linear'},{value:'sharp',label:'Sharp'}]} disabled={off} unstyled={unstyled} onChange={tip=>set({tip})}/>
  <SettingSwitch label="Pressure taper" on={taper.pressure} disabled={off||!pressureAvailable} styled={!unstyled} hint={!pressureAvailable?'This input does not report pressure':undefined} onChange={pressure=>set({pressure})}/>
  {renderTestStroke(taper,input)}
  {off?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Applying taper'}</Text>:null}<ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
