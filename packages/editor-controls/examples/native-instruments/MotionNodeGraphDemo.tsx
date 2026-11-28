import {useRef} from 'react';
import {Platform,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {NodeGraphEditor,type GraphNode,type GraphEdge} from '@nitro-forge/editor-controls/motion/NodeGraphEditor';
const node=(id:string,title:string,x:number,y:number,type='float'):GraphNode=>({id,title,x,y,inputs:[{id:'in',label:'Input',dataType:type}],outputs:[{id:'out',label:'Output',dataType:type}]});
const initial=()=>[node('time','Time',20,20),node('scale','Scale',280,20),node('tint','Tint',540,20,'color')];
const makeStore=()=>createStore(()=>({scope:'graph-a',revision:0,nodes:initial(),edges:[] as readonly GraphEdge[],selected:'time' as string|null,commits:0,next:1,reject:false,slow:false,width:280,height:0}));
export function MotionNodeGraphDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v);return <View style={{flex:1,padding:16,gap:8}} onLayout={event=>{const width=Math.max(120,Math.min(640,event.nativeEvent.layout.width-32));const height=event.nativeEvent.layout.height;if(width!==store.getState().width||height!==store.getState().height)store.setState({width,height});}}>
 {Platform.OS==='web'?<View style={{gap:8}}>
 <Button title="Switch graph document" onPress={()=>store.setState(s=>({scope:s.scope==='graph-a'?'graph-b':'graph-a',revision:s.revision+1,nodes:initial(),edges:[],selected:'time',commits:0}))}/>
 <Button title={s.reject?'Allow graph writes':'Reject graph writes'} onPress={()=>store.setState({reject:!s.reject})}/>
 <Button title={s.slow?'Use fast graph provider':'Use slow graph provider'} onPress={()=>store.setState({slow:!s.slow})}/>
 </View>:null}
 <NodeGraphEditor scope={s.scope} revision={s.revision} nodes={s.nodes} edges={s.edges} selectedNodeId={s.selected} onSelectNode={selected=>store.setState({selected})} availableNodeTypes={[{id:'math',label:'Math'}]} width={s.width} height={Math.max(100,Math.min(280,s.height-280))} onMutation={async(mutation,signal)=>{await new Promise(resolve=>setTimeout(resolve,store.getState().slow?500:20));if(signal.aborted)return;if(store.getState().reject)throw new Error('Graph provider rejected this edit');store.setState(s=>{let nodes=s.nodes,edges=s.edges;switch(mutation.type){case 'move':nodes=nodes.map(n=>n.id===mutation.nodeId?{...n,...mutation.point}:n);break;case 'connect':edges=[...edges,{id:`link${s.next}`,from:mutation.from,to:mutation.to}];break;case 'disconnect':edges=edges.filter(e=>e.id!==mutation.edgeId);break;case 'remove':nodes=nodes.filter(n=>n.id!==mutation.nodeId);edges=edges.filter(e=>e.from.nodeId!==mutation.nodeId&&e.to.nodeId!==mutation.nodeId);break;case 'add':nodes=[...nodes,node(`new${s.next}`,'Math',100,240)];break;}return {nodes,edges,revision:s.revision+1,commits:s.commits+1,next:s.next+1};});}}/>
 <Text {...{className:'text-text'}} testID="motion-node-graph-state" numberOfLines={3} accessibilityLabel={`Motion node graph state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;}
