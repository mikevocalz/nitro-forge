import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {View,Text,type ViewProps} from 'react-native';
import {WaveformLane,type WaveformLaneProps} from '../WaveformLane.tsx';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
export interface AudioClipRegion {startSample:number;endSample:number;fadeInSamples:number;fadeOutSamples:number;gainDb:number;crossfade:'none'|'linear'|'equal-power'}
export interface AudioClipTrimAndFadeProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 lengthSamples:number;sampleRate:number;region:AudioClipRegion;peaks:WaveformLaneProps['peaks'];
 onCommit:(region:AudioClipRegion,signal?:AbortSignal)=>unknown;onPreview?:(region:AudioClipRegion)=>void;
 /** Report a verified neighbouring overlap before enabling crossfade. */
 overlapSamples?:number;unstyled?:boolean;
}
import {Button} from '@nyc-tron/ui/components/Button';
export function AudioClipTrimAndFade({scope='audio-region',revision=0,...props}:AudioClipTrimAndFadeProps){
 const {lengthSamples,sampleRate,region,peaks,overlapSamples=0,onCommit:_commit,onPreview:_preview,disabledReason,unstyled=false,style,...rest}=props;
 const {startSample,endSample,fadeInSamples,fadeOutSamples,gainDb,crossfade}=region,span=endSample-startSample;
 if(!Number.isSafeInteger(lengthSamples)||lengthSamples<1||!Number.isFinite(sampleRate)||sampleRate<1||sampleRate>768000||![startSample,endSample,fadeInSamples,fadeOutSamples,overlapSamples].every(Number.isSafeInteger)||startSample<0||endSample>lengthSamples||span<1||fadeInSamples<0||fadeOutSamples<0||fadeInSamples+fadeOutSamples>span||overlapSamples<0||overlapSamples>span||!Number.isFinite(gainDb)||gainDb< -144||gainDb>24||!['none','linear','equal-power'].includes(crossfade))throw new RangeError('Invalid audio region');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),lengthSamples,sampleRate,disabledReason,overlapSamples])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const next=(patch:Partial<AudioClipRegion>,base=region)=>{const r={...base,...patch},n=r.endSample-r.startSample;r.fadeInSamples=Math.min(r.fadeInSamples,n);r.fadeOutSamples=Math.min(r.fadeOutSamples,n-r.fadeInSamples);return r;};
 const commit=(patch:Partial<AudioClipRegion>)=>guard.run('region',(host,signal)=>host.onCommit(next(patch,host.region),signal));
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="Audio clip trim and fades">
  <WaveformLane peaks={peaks} visibleRange={{start:startSample/lengthSamples,end:endSample/lengthSamples}} unstyled={unstyled}/>
  <Text {...{className:unstyled?undefined:'text-text'}}>Region: {(span/sampleRate).toFixed(3)} s · {crossfade} crossfade</Text>
  {([{key:'startSample',label:'Clip start sample',min:0,max:endSample-1},{key:'endSample',label:'Clip end sample',min:startSample+1,max:lengthSamples},{key:'fadeInSamples',label:'Fade in samples',min:0,max:span-fadeOutSamples},{key:'fadeOutSamples',label:'Fade out samples',min:0,max:span-fadeInSamples},{key:'gainDb',label:'Region gain',min:-144,max:24}] as const).map(f=>f.max>f.min?<PrecisionScrubber key={f.key} scope={owner+f.key} revision={revision} label={f.label} min={f.min} max={f.max} step={f.key==='gainDb' ? .1 : 1} value={region[f.key]} unit={f.key==='gainDb'?'dB':'samples'} disabled={off} unstyled={unstyled} onPreview={value=>guard.current()?.onPreview?.(next({[f.key]:value}))} onCommit={value=>commit({[f.key]:value})}/>:null)}
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{(['none','linear','equal-power'] as const).map(shape=><Button key={shape} title={shape+' crossfade'} variant="secondary" accessibilityState={{selected:crossfade===shape}} disabled={off||shape!=='none'&&overlapSamples===0} unstyled={unstyled} onPress={()=>commit({crossfade:shape})}/>)}</View>
  <ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/>
 </View>;
}
