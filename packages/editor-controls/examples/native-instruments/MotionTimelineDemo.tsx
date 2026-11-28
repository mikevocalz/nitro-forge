import {useRef} from 'react';
import {Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {MotionKeyframeTimeline,type MotionPropertyCurve,type MotionKeySelection} from '@nitro-forge/editor-controls/motion/MotionKeyframeTimeline';
const key=(id:string,time:number)=>({id,time,value:0,interpolation:'linear' as const,inHandle:null,outHandle:null});
const curves=():readonly MotionPropertyCurve[]=>[{id:'x',label:'Position X',minimum:-100,maximum:100,baseValue:0,keys:[key('a',0),key('b',1),key('c',2),key('d',3)]},{id:'y',label:'Position Y',minimum:-100,maximum:100,baseValue:0,keys:[key('a',0),key('b',.5),key('c',2.5)]}];
const makeStore=()=>createStore(()=>({scope:'composition-a',revision:0,curves:curves(),selection:[{propertyId:'x',keyId:'b'}] as readonly MotionKeySelection[],view:[0,4] as readonly [number,number],snap:true,playhead:.25,preview:false,commits:0,height:0}));
export function MotionTimelineDemo(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,value=>value);
 return <View style={{padding:16,gap:8,maxWidth:720,width:'100%',flex:1}} onLayout={event=>{const height=event.nativeEvent.layout.height;if(height!==store.getState().height)store.setState({height});}}>
  <Button title="Switch timeline composition" onPress={()=>store.setState(s=>({scope:s.scope==='composition-a'?'composition-b':'composition-a',revision:s.revision+1,curves:curves(),selection:[{propertyId:'x',keyId:'b'}],commits:0,preview:false}))}/>
  <MotionKeyframeTimeline scope={s.scope} revision={String(s.revision)} curves={s.curves} duration={4} selection={s.selection} onSelectionChange={selection=>store.setState({selection})} onCommit={(curves,selection)=>store.setState(s=>({curves,selection,revision:s.revision+1,commits:s.commits+1}))} onPreview={curves=>store.setState({preview:!!curves})} viewRange={s.view} onViewRangeChange={view=>store.setState({view})} playhead={s.playhead} onPlayheadChange={playhead=>store.setState({playhead})} frameRate={{numerator:4,denominator:1}} snapToFrames={s.snap} onSnapChange={snap=>store.setState({snap})} height={Math.max(100,Math.min(320,s.height-300))}/>
  <Text numberOfLines={3} testID="motion-timeline-state" accessibilityLabel={`Motion timeline state ${JSON.stringify(s)}`} {...{className:'text-text'}}>{JSON.stringify(s)}</Text>
 </View>;
}
