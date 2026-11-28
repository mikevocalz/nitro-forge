import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {Button} from '@nyc-tron/ui/components/Button';
import {KeyframeValueGraph} from '@nitro-forge/editor-controls/motion/KeyframeValueGraph';
import {KeyframeSpeedGraph} from '@nitro-forge/editor-controls/motion/KeyframeSpeedGraph';
import {TimeRemapCurve} from '@nitro-forge/editor-controls/motion/TimeRemapCurve';
import type {MotionPropertyCurve} from '@nitro-forge/editor-controls/motion/motion-curves';
const curve=():MotionPropertyCurve=>({id:'position-x',label:'Position X',minimum:-100,maximum:100,baseValue:0,keys:[{id:'a',time:0,value:0,interpolation:'bezier',inHandle:null,outHandle:{time:.2,value:30}},{id:'b',time:1,value:40,interpolation:'linear',inHandle:{time:.8,value:10},outHandle:null},{id:'c',time:2,value:0,interpolation:'linear',inHandle:null,outHandle:null}]});
const remap=():MotionPropertyCurve=>({id:'source-time',label:'Source time',minimum:0,maximum:4,baseValue:0,keys:[{id:'r1',time:0,value:3,interpolation:'linear',inHandle:null,outHandle:null},{id:'r2',time:2,value:1,interpolation:'linear',inHandle:null,outHandle:null},{id:'r3',time:3,value:1,interpolation:'linear',inHandle:null,outHandle:null}]});
const makeStore=()=>createStore(()=>({section:'Value' as 'Value'|'Speed'|'Remap',scope:'composition-a',revision:0,value:curve(),remap:remap(),selected:'a' as string|null,selectedRemap:'r2' as string|null,view:[0,3] as readonly [number,number],preview:false,commits:0,nextId:1}));
/** Real curve math in a controlled document fixture; no timeline renderer or decoder is started. */
export function MotionCurvesDemo(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 const id=()=>{const value=`added-${store.getState().nextId}`;store.setState(s=>({nextId:s.nextId+1}));return value;};
 const shared={scope:s.scope,revision:String(s.revision),duration:3,playhead:.5,viewRange:s.view,onViewRangeChange:(view:readonly [number,number])=>store.setState({view}),createKeyId:id,onPreview:(value:MotionPropertyCurve|undefined)=>store.setState({preview:!!value}),height:200};
 const normal={...shared,value:s.value,selectedId:s.selected,onSelect:(selected:string|null)=>store.setState({selected}),onCommit:(value:MotionPropertyCurve,selected:string|null)=>store.setState(s=>({value,selected,revision:s.revision+1,commits:s.commits+1}))};
 return <View style={{padding:16,gap:8,maxWidth:700,width:'100%',flex:1}}>
  <TabBar tabs={(['Value','Speed','Remap'] as const).map(key=>({key,label:key,active:s.section===key,onPress:()=>store.setState({section:key})}))}/>
  <Button title="Switch motion composition" onPress={()=>store.setState(s=>({scope:s.scope==='composition-a'?'composition-b':'composition-a',revision:s.revision+1,value:curve(),selected:'a',commits:0,preview:false}))}/>
  <ScrollView style={{maxHeight:700}} contentContainerStyle={{gap:8}} keyboardShouldPersistTaps="handled">
   {s.section==='Value'?<KeyframeValueGraph {...normal}/>:s.section==='Speed'?<KeyframeSpeedGraph {...normal}/>:<TimeRemapCurve {...shared} value={s.remap} sourceDuration={4} selectedId={s.selectedRemap} onSelect={selectedRemap=>store.setState({selectedRemap})} onCommit={(remap,selectedRemap)=>store.setState(s=>({remap,selectedRemap,revision:s.revision+1,commits:s.commits+1}))}/>}
  </ScrollView>
  <Text testID="motion-curves-state" numberOfLines={3} accessibilityLabel={`Motion curves state ${JSON.stringify(s)}`} {...{className:'text-text'}}>{JSON.stringify(s)}</Text>
 </View>;
}
