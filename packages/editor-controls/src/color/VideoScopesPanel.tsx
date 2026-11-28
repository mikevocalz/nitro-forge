import {Text,View,type ViewProps} from "react-native";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {LiveHistogram,type LiveHistogramProps} from "./LiveHistogram.tsx";
import {poolScope,bounded,type ScopeSample} from "./color-adjustments.ts";
export type {ScopeSample} from "./color-adjustments.ts";
/** Frame-tagged engine measurements; a missing frame is different from a measured empty scope. */
export interface VideoScopesPanelProps extends Omit<ViewProps,'children'> {
 readonly frameTimeUs:number|null;
 readonly mode:'histogram'|'waveform'|'vectorscope'|'rgb-parade';
 readonly onModeChange:(mode:VideoScopesPanelProps['mode'])=>void;
 readonly histogram:LiveHistogramProps['channels'];
 readonly domain:readonly [number,number];
 readonly waveform:readonly ScopeSample[];
 readonly vectorscope:readonly ScopeSample[];
 /** Three engine-provided RGB channel scopes on the same decoded frame. */
 readonly parade?:readonly {readonly id:'red'|'green'|'blue';readonly samples:readonly ScopeSample[]}[];
 readonly height?:number;readonly unstyled?:boolean;
}
/** Renders actual decoded measurements with bounded density pooling; no synthetic scope signal. */
export function VideoScopesPanel({frameTimeUs,mode,onModeChange,histogram,domain,waveform,vectorscope,parade=[],height=180,unstyled=false,...props}:VideoScopesPanelProps){
 if(frameTimeUs!==null&&(!Number.isSafeInteger(frameTimeUs)||frameTimeUs<0))throw new RangeError('Scope frame time must be nonnegative integer microseconds');bounded(height,88,600,'Scope height');
 if(!['histogram','waveform','vectorscope','rgb-parade'].includes(mode))throw new TypeError('Unknown video scope mode');
 if(mode==='rgb-parade'&&(parade.length!==3||new Set(parade.map(p=>p.id)).size!==3||parade.some(p=>!['red','green','blue'].includes(p.id))))throw new TypeError('RGB parade needs all three measured channels');
 const samples=mode==='waveform'?waveform:vectorscope,grid=mode==='histogram'?[]:poolScope(samples),peak=Math.max(0,...grid);
 return <View {...props} style={[{gap:8},props.style]}>
  <SegmentedControl aria-label="Video scope" value={mode} onChange={onModeChange} options={[{value:'histogram',label:'Histogram'},{value:'waveform',label:'Waveform'},{value:'vectorscope',label:'Vectorscope'},{value:'rgb-parade',label:'RGB parade'}]} unstyled={unstyled}/>
  <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{frameTimeUs===null?'No decoded scope frame':`Decoded frame ${frameTimeUs} microseconds`}</Text>
  {frameTimeUs===null?null:mode==='rgb-parade'?<View style={{flexDirection:'row',gap:4}}>{parade.map(channel=>{const counts=poolScope(channel.samples,16),maximum=Math.max(0,...counts);return <View key={channel.id} accessible accessibilityLabel={`${channel.id} parade, ${channel.samples.length} decoded samples`} style={{flex:1,gap:4}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{channel.id}</Text><View style={{height,flexDirection:'row',flexWrap:'wrap'}}>{counts.map((density,index)=><View key={index} pointerEvents="none" {...{className:joinClasses(!unstyled&&'bg-primary')}} style={{width:'6.25%',height:height/16,opacity:maximum?Math.log1p(density)/Math.log1p(maximum):0}}/>)}</View></View>;})}</View>:mode==='histogram'?<LiveHistogram channels={histogram} domain={domain} height={height} unstyled={unstyled}/>:<View accessible accessibilityLabel={`${mode}, ${samples.length} decoded samples`} style={{height,flexDirection:'row',flexWrap:'wrap'}}>
   {grid.map((density,index)=><View key={index} pointerEvents="none" {...{className:joinClasses(!unstyled&&'bg-primary')}} style={{width:'3.125%',height:height/32,opacity:peak?Math.log1p(density)/Math.log1p(peak):0}}/>)}
  </View>}
 </View>;
}
