import {useRef} from 'react';
import {Platform,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {MotionPathEditor,type Subpath,type NodeRef} from '@nitro-forge/editor-controls/motion/MotionPathEditor';
const initial=():readonly Subpath[]=>[{closed:false,nodes:[{x:60,y:100,kind:'corner',out:[40,4]},{x:160,y:60,kind:'smooth',in:[-30,0],out:[30,0]},{x:260,y:140,kind:'corner',in:[-30,0]}]}];
const makeStore=()=>createStore(()=>({scope:'trajectory-a',revision:0,paths:initial(),selection:{subpath:0,index:0} as NodeRef|undefined,commits:0,preview:false,snap:true,width:280,height:0}));
export function MotionPathDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v);return <View style={{flex:1,padding:16,gap:8}} onLayout={event=>{const width=Math.max(120,Math.min(320,event.nativeEvent.layout.width-32));const height=event.nativeEvent.layout.height;if(width!==store.getState().width||height!==store.getState().height)store.setState({width,height});}}>
 {Platform.OS==='web'?<View style={{gap:8}}>
 <Button title="Switch motion path document" onPress={()=>store.setState(s=>({scope:s.scope==='trajectory-a'?'trajectory-b':'trajectory-a',revision:s.revision+1,paths:initial(),selection:{subpath:0,index:0},commits:0,preview:false}))}/>
 <Button title={s.snap?'Disable path snapping':'Enable path snapping'} onPress={()=>store.setState({snap:!s.snap})}/>
 </View>:null}
 <MotionPathEditor scope={s.scope} revision={s.revision} subpaths={s.paths} selection={s.selection} onSelectionChange={selection=>store.setState({selection})} width={s.width} height={Platform.OS==='web'?220:Math.max(100,Math.min(220,s.height-300))} snapping={{grid:s.snap?20:0,tolerance:10,targets:[],tangentAngleDegrees:s.snap?45:0}} onPreview={paths=>store.setState({preview:!!paths})} onCommit={paths=>store.setState(s=>({paths,commits:s.commits+1,revision:s.revision+1}))}/>
 <Text {...{className:'text-text'}} testID="motion-path-state" numberOfLines={3} accessibilityLabel={`Motion path state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;}
