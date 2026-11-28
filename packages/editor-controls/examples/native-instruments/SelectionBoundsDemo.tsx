import {useRef} from 'react';
import {Text,View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {CanvasPanZoom,type CanvasViewport} from '@nitro-forge/editor-controls/canvas/CanvasPanZoom';
import {SelectionBounds,type SelectionFrame} from '@nitro-forge/editor-controls/selection/SelectionBounds';
const initial=():SelectionFrame=>({centerX:180,centerY:240,width:200,height:160,rotation:0});
function makeStore(hinge=false){const selected=()=>({...initial(),...(hinge?{centerX:280}:{})});return createStore(()=>({document:'a' as 'a'|'b',frames:{a:selected(),b:selected()},preview:undefined as SelectionFrame|undefined,disabled:false,width:560,view:{zoom:1,panX:0,panY:0},navigationEvents:0,panTool:false,events:[] as string[]}));}
export function SelectionBoundsDemo({hinge=false,withNavigation=false}:{hinge?:boolean;withNavigation?:boolean}){
 const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore(hinge);const store=ref.current,s=useStore(store,v=>v),frame=s.frames[s.document],shown=s.preview??frame,viewport={...s.view,width:s.width,height:420},regions=hinge?[{x:0,y:0,width:s.width/2-30,height:420},{x:s.width/2+30,y:0,width:s.width/2-30,height:420}]:undefined;
 const renderContent=(view:CanvasViewport)=><> <View pointerEvents="none" {...{className:'bg-surface-raised border border-border'}} style={{position:'absolute',left:view.panX+(shown.centerX-shown.width/2)*view.zoom,top:view.panY+(shown.centerY-shown.height/2)*view.zoom,width:shown.width*view.zoom,height:shown.height*view.zoom,transform:[{rotate:shown.rotation+'deg'}]}}/>
 <SelectionBounds scope={s.document} frame={frame} viewport={view} disabled={s.disabled} {...(regions?{usableRegions:regions}:{})} onPreview={preview=>store.setState({preview})} onCommit={(value,detail)=>store.setState(v=>v.document!==s.document?v:{frames:{...v.frames,[s.document]:value},preview:undefined,events:[...v.events,s.document+':'+detail.handle+':'+detail.source]})}/>
</>;
 return <View style={{flex:1,gap:8,padding:8}}><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Button title="Replace selection document" onPress={()=>store.setState(v=>({document:v.document==='a'?'b':'a',preview:undefined}))}/><Button title="Toggle selection availability" onPress={()=>store.setState(v=>({disabled:!v.disabled,preview:undefined}))}/><Button title="Use canvas pan tool" onPress={()=>store.setState(v=>({panTool:!v.panTool}))}/><Button title="Use small selection" onPress={()=>store.setState(v=>({frames:{...v.frames,[v.document]:{...v.frames[v.document],width:30,height:20}}}))}/></View>
 <GestureHandlerRootView style={{height:420}}><View testID="selection-bounds-surface" style={{height:420,overflow:'hidden'}} onLayout={event=>{const width=event.nativeEvent.layout.width;if(width>0&&store.getState().width!==width)store.setState({width});}}>
 {withNavigation?<CanvasPanZoom panWithOnePointer={s.panTool} scope={s.document} viewport={viewport} label="Selection canvas navigation" onCommit={value=>store.setState(v=>({view:{zoom:value.zoom,panX:value.panX,panY:value.panY},navigationEvents:v.navigationEvents+1}))}>{view=>renderContent(view)}</CanvasPanZoom>:renderContent(viewport)}
 </View></GestureHandlerRootView><Text testID="selection-bounds-state" accessibilityLabel={'Selection bounds state '+JSON.stringify(s)} {...{className:'text-text'}}>{JSON.stringify(s)}</Text></View>;
}
