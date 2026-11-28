import {Text,View,type ViewProps} from 'react-native';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {VideoScopesPanel,type VideoScopesPanelProps} from '../color/VideoScopesPanel.tsx';
export interface ScopesDockProps extends Omit<ViewProps,'children'> {
 target:'source'|'program';onTargetChange:(target:'source'|'program')=>void;
 source:VideoScopesPanelProps;program:VideoScopesPanelProps;
 expectedFrameTimeUs?:number;unstyled?:boolean;
}
/** Actual decoder/compositor measurements, with source/program assignment and stale-frame disclosure. */
export function ScopesDock({target,onTargetChange,source,program,expectedFrameTimeUs,unstyled=false,style,...props}:ScopesDockProps){
 if(!['source','program'].includes(target)||expectedFrameTimeUs!==undefined&&(!Number.isSafeInteger(expectedFrameTimeUs)||expectedFrameTimeUs<0))throw new RangeError('Invalid scope assignment');
 const data=target==='source'?source:program,stale=expectedFrameTimeUs!==undefined&&data.frameTimeUs!==expectedFrameTimeUs;
 return <View {...props} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Video scopes dock">
  <SegmentedControl aria-label="Scope source" value={target} onChange={onTargetChange} options={[{value:'source',label:'Source'},{value:'program',label:'Program'}]} unstyled={unstyled}/>
  {stale?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">Scopes are not from the current presented frame</Text>:null}
  <VideoScopesPanel {...data} unstyled={unstyled}/>
 </View>;
}
