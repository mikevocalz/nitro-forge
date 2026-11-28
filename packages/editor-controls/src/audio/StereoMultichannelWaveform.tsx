import {Text,View,type ViewProps} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {WaveformLane} from '../WaveformLane.tsx';
import {normalizePeak,type WaveformPeak} from '../waveform.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import { tokens } from '../tokens.ts';
export interface AudioWaveformChannel {id:string;label:string;peaks:readonly WaveformPeak[];rms?:readonly number[]}
export interface StereoMultichannelWaveformProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 channels:readonly AudioWaveformChannel[];mode:'peak'|'rms';onModeChange:(mode:'peak'|'rms')=>void;
 position?:number;onSeek?:(position:number)=>void;heightPerChannel?:number;unstyled?:boolean;
}
export function StereoMultichannelWaveform({scope='multichannel-waveform',revision=0,...props}:StereoMultichannelWaveformProps){
 const {channels,mode,onModeChange:_mode,position,onSeek,heightPerChannel=64,unstyled=false,disabledReason,style,...rest}=props;
 if(channels.length>64||new Set(channels.map(c=>c.id)).size!==channels.length||channels.some(c=>!c.id.trim()||c.id.length>512||!c.label.trim()||c.peaks.length>8192||(c.rms?.length??0)>8192||c.rms?.some(n=>!Number.isFinite(n)||n<0))||!['peak','rms'].includes(mode)||!Number.isFinite(heightPerChannel)||heightPerChannel<44||heightPerChannel>1024)throw new RangeError('Invalid channel waveform');
 for(const channel of channels)for(const peak of channel.peaks)normalizePeak(peak);
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason,channels.map(c=>c.id)]),guard=useScopedControl(owner,props,disabledReason!==undefined);
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Channel waveforms">
  <SegmentedControl aria-label="Waveform measurement" value={mode} options={[{value:'peak',label:'Peak extrema'},{value:'rms',label:'RMS envelope',disabled:!channels.some(c=>c.rms!==undefined)}]} disabled={disabledReason!==undefined} unstyled={unstyled} onChange={value=>guard.current()?.onModeChange(value)}/>
  <FlatList key={owner} data={channels} keyExtractor={c=>c.id} initialNumToRender={4} windowSize={5} style={{maxHeight:tokens.spacing.off600}} extraData={[mode,position,disabledReason]} renderItem={({item})=>{
   const peaks=mode==='peak'?item.peaks:item.rms?.map(rms=>({min:-rms,max:rms}));
   return <View style={{gap:tokens.spacing.fixedStack,paddingVertical:tokens.spacing.fixedStack}}><Text {...{className:unstyled?undefined:'text-text'}}>{item.label}</Text>
    {peaks?.length?<WaveformLane key={owner+':'+mode+':'+item.id} peaks={peaks} columns={512} height={heightPerChannel} unstyled={unstyled} {...(position===undefined?{}:{position})} {...(onSeek&&disabledReason===undefined?{onSeekNormalized:(value:number)=>guard.current()?.onSeek?.(value)}:{})}/>:<Text {...{className:unstyled?undefined:'text-text'}}>{mode==='rms'?'RMS measurement not reported':'No decoded channel peaks'}</Text>}
   </View>;
  }}/>
 </View>;
}
