import {Text,View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface AudioDeviceChoice {id:string;label:string;kind:'input'|'output';channels:readonly {id:string;label:string}[];sampleRates:readonly number[];unavailableReason?:string}
export interface AudioDeviceSelection {inputId:string|null;outputId:string|null;channelIds:readonly string[];sampleRate:number}
export interface DeviceAndChannelPickerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 devices:readonly AudioDeviceChoice[];value:AudioDeviceSelection;recording:boolean;onCommit:(selection:AudioDeviceSelection,signal?:AbortSignal)=>void|Promise<unknown>;onRefresh:(signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function DeviceAndChannelPicker({scope='audio-device',revision=0,...props}:DeviceAndChannelPickerProps){
 const {devices,value,recording,onCommit:_commit,onRefresh:_refresh,unstyled=false,disabledReason,style,...rest}=props;
 if(devices.length>256||new Set(devices.map(d=>d.kind+':'+d.id)).size!==devices.length||devices.some(d=>!d.id.trim()||d.id.length>512||!d.label.trim()||d.channels.length>256||new Set(d.channels.map(c=>c.id)).size!==d.channels.length||d.channels.some(c=>!c.id.trim()||c.id.length>512||!c.label.trim()||c.label.length>1024)||!['input','output'].includes(d.kind)||d.sampleRates.length>64||d.sampleRates.some(n=>!Number.isInteger(n)||n<1||n>768000))||!Number.isInteger(value.sampleRate)||value.sampleRate<1||value.sampleRate>768000||value.channelIds.length>256||new Set(value.channelIds).size!==value.channelIds.length)throw new RangeError('Invalid audio device roster');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),recording,disabledReason,devices]),props,recording||disabledReason!==undefined),off=guard.pending||recording||disabledReason!==undefined;
 const input=devices.find(d=>d.kind==='input'&&d.id===value.inputId),output=devices.find(d=>d.kind==='output'&&d.id===value.outputId),rates=(input?.sampleRates??output?.sampleRates??[]).filter(rate=>!output||output.sampleRates.includes(rate));
 const commit=(patch:Partial<AudioDeviceSelection>)=>guard.run('device',(host,signal)=>host.onCommit({...host.value,...patch},signal));
 const chooseDevice=(kind:'input'|'output',id:string)=>guard.run('device',(host,signal)=>{
  const next={...host.value,...(kind==='input'?{inputId:id||null,channelIds:[] as string[]}:{outputId:id||null})};
  const input=host.devices.find(d=>d.kind==='input'&&d.id===next.inputId),output=host.devices.find(d=>d.kind==='output'&&d.id===next.outputId);
  if(id&&!host.devices.some(d=>d.kind===kind&&d.id===id&&d.unavailableReason===undefined))throw new Error('The selected audio device is no longer available');
  const available=(input?.sampleRates??output?.sampleRates??[host.value.sampleRate]).filter(rate=>!output||output.sampleRates.includes(rate));
  if(!available.length)throw new Error('Input and output devices have no shared reported sample rate');
  if(!available.includes(next.sampleRate))next.sampleRate=available[0]!;
  if(kind==='input'&&input?.channels[0])next.channelIds=[input.channels[0].id];
  return host.onCommit(next,signal);
 });
 const options=(kind:AudioDeviceChoice['kind'])=>[{value:'',label:'System default'},...devices.filter(d=>d.kind===kind).map(d=>({value:d.id,label:d.label,disabled:d.unavailableReason!==undefined}))];
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Audio devices and channels">
  <Select label="Audio input device" value={value.inputId??''} options={options('input')} disabled={off} unstyled={unstyled} onValueChange={id=>chooseDevice('input',id)}/>
  <Select label="Audio output device" value={value.outputId??''} options={options('output')} disabled={off} unstyled={unstyled} onValueChange={id=>chooseDevice('output',id)}/>
  <Select label="Audio sample rate" value={String(value.sampleRate)} options={rates.map(rate=>({value:String(rate),label:rate+' Hz'}))} disabled={off||rates.length===0} unstyled={unstyled} onValueChange={rate=>commit({sampleRate:Number(rate)})}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{input?.channels.map(channel=><Button key={channel.id} title={channel.label} accessibilityState={{checked:value.channelIds.includes(channel.id)}} disabled={off} unstyled={unstyled} onPress={()=>guard.run('channel',(host,signal)=>{const ids=host.value.channelIds;return host.onCommit({...host.value,channelIds:ids.includes(channel.id)?ids.filter(id=>id!==channel.id):[...ids,channel.id]},signal);})}/>)}</View>
  {recording?<Text {...{className:unstyled?undefined:'text-text'}}>Stop recording before changing audio devices or sample rate.</Text>:null}
  <Button title="Refresh audio devices" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.run('refresh',(host,signal)=>host.onRefresh(signal))}/>
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
