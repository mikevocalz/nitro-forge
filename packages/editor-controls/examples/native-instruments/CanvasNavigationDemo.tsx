import {useRef,useId,type ComponentRef} from 'react';
import {Text,View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {CanvasPanZoom,type CanvasViewport} from '@nitro-forge/editor-controls/canvas/CanvasPanZoom';
interface State {documentId:'canvas-a'|'canvas-b';viewports:Record<'canvas-a'|'canvas-b',CanvasViewport>;commits:readonly string[];previews:number;disabled:boolean}
const viewport=():CanvasViewport=>({zoom:1,panX:20,panY:20,width:360,height:300});
function makeStore(){return createStore<State>(()=>({documentId:'canvas-a',viewports:{'canvas-a':viewport(),'canvas-b':viewport()},commits:[],previews:0,disabled:false}));}
/** Demonstrates viewport navigation with an RN scene; it does not claim GPU rendering or engine operations. */
export function CanvasNavigationDemo({occluded=false}:{occluded?:boolean}){
 const root=useRef<ComponentRef<typeof View>|null>(null),ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v),id=s.documentId,current=s.viewports[id];
 const regions=occluded?[{x:0,y:0,width:current.width/2-20,height:current.height},{x:current.width/2+20,y:0,width:current.width/2-20,height:current.height}]:undefined;
 return <View ref={root} style={{flex:1,gap:8,padding:8}} onLayout={event=>{const width=Math.max(1,event.nativeEvent.layout.width-16),height=Math.max(160,Math.min(360,event.nativeEvent.layout.height-150));const p=store.getState();if(p.viewports['canvas-a'].width!==width||p.viewports['canvas-a'].height!==height)store.setState({viewports:{'canvas-a':{...p.viewports['canvas-a'],width,height},'canvas-b':{...p.viewports['canvas-b'],width,height}}});}}>
  <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}><Button title="Next canvas document" onPress={()=>store.setState(v=>({documentId:v.documentId==='canvas-a'?'canvas-b':'canvas-a'}))}/><Button title="Toggle canvas navigation" onPress={()=>store.setState(v=>({disabled:!v.disabled}))}/></View>
  <GestureHandlerRootView style={{height:current.height}}><CanvasPanZoom testID="canvas-navigation-viewport" scope={id} label="Canvas navigation" viewport={current} disabled={s.disabled} contentBounds={{x:0,y:0,w:400,h:300}} {...(regions?{usableRegions:regions}:{})} onPreview={()=>store.setState(v=>({previews:v.previews+1}))} onCommit={value=>store.setState(v=>v.documentId!==id?v:{viewports:{...v.viewports,[id]:value},commits:[...v.commits,id+':'+JSON.stringify(value)].slice(-30)})}>{value=><Scene key={id} viewport={value}/>}</CanvasPanZoom></GestureHandlerRootView>
  <Text testID="canvas-navigation-state" numberOfLines={5} accessibilityLabel={'Canvas navigation state '+JSON.stringify(s)} {...{className:'text-text'}}>{JSON.stringify(s)}</Text>
 </View>;
}
function Scene({viewport:v}:{viewport:CanvasViewport}){const id=useId();return <View pointerEvents="none" style={{position:'absolute',inset:0}}><View testID="navigation-document" {...{className:'border border-border bg-surface-raised'}} style={{position:'absolute',left:v.panX,top:v.panY,width:400*v.zoom,height:300*v.zoom}}><Text testID="navigation-scene-instance" {...{className:'text-text'}}>Scene {id}</Text><Text {...{className:'text-text'}}>Document 400 × 300</Text></View></View>;}
