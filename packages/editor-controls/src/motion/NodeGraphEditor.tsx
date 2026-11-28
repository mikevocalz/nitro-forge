import {useMemo,useRef} from 'react';
import {FlatList,ScrollView,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {PatchGraph} from '../graph/PatchGraph.tsx';
import type {GraphNode,GraphEdge,GraphEndpoint,GraphPoint} from '../graph/model.ts';
import {validateEffectChoices} from './motion-effects.ts';
import {validateMotionNodeGraph,validateMotionConnection,motionGraphCanvasSize,type NodeGraphPolicy} from './motion-node-graph.ts';
export type {GraphNode,GraphEdge,GraphPort,GraphEndpoint,GraphPoint} from '../graph/model.ts';
export type {NodeGraphPolicy} from './motion-node-graph.ts';
export type NodeGraphMutation={readonly type:'move';readonly nodeId:string;readonly point:GraphPoint}|{readonly type:'connect';readonly from:GraphEndpoint;readonly to:GraphEndpoint}|{readonly type:'disconnect';readonly edgeId:string}|{readonly type:'remove';readonly nodeId:string}|{readonly type:'add';readonly typeId:string};
export interface NodeGraphEditorProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly revision:string|number;readonly nodes:readonly GraphNode[];readonly edges:readonly GraphEdge[];readonly selectedNodeId:string|null;readonly onSelectNode:(id:string)=>void;
 readonly onMutation:(mutation:NodeGraphMutation,signal:AbortSignal)=>void|Promise<void>;
 readonly availableNodeTypes?:readonly {readonly id:string;readonly label:string}[];readonly policy?:NodeGraphPolicy;readonly width:number;readonly height:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
interface Local {section:string;source:GraphEndpoint|null;sourceIdentity:string|null;notice:{identity:string;message:string}|null;epoch:number}
const NO_TYPES:readonly {id:string;label:string}[]=[];
/** Typed, bounded graph editor. The host owns atomic graph mutation and evaluation. */
export function NodeGraphEditor(props:NodeGraphEditorProps){return <GraphEditor key={props.scope} {...props}/>;}
function GraphEditor({scope,revision,nodes,edges,selectedNodeId,onSelectNode,onMutation,availableNodeTypes=NO_TYPES,policy,width,height,disabled=false,unstyled=false,...props}:NodeGraphEditorProps){
 useMemo(()=>validateMotionNodeGraph(nodes,edges,policy),[nodes,edges,policy]);useMemo(()=>validateEffectChoices(availableNodeTypes),[availableNodeTypes]);if(!scope.trim()||typeof revision==='number'&&!Number.isFinite(revision))throw new RangeError('Invalid node graph identity');const size=motionGraphCanvasSize(nodes,width,height),identity=JSON.stringify([scope,revision]);
 const [local,store]=useLocalStore<Local>(()=>({section:'graph',source:null,sourceIdentity:null,notice:null,epoch:0}));const action=useOwnedAction(identity),locked=disabled||action.pending!==null,selected=nodes.find(n=>n.id===selectedNodeId),rendererKey=JSON.stringify([identity,local.epoch,action.pending,disabled,width,height]);
 const current=useRef({rendererKey,locked});current.current={rendererKey,locked};
 const notice=(message:string)=>store.set(s=>({...s,notice:{identity,message}}));
 const run=(mutation:NodeGraphMutation)=>{if(current.current.rendererKey!==rendererKey||current.current.locked)return Promise.resolve(false);
  try {if(mutation.type==='connect')validateMotionConnection(nodes,edges,mutation.from,mutation.to,policy);if(mutation.type==='move')validateMotionNodeGraph(nodes.map(n=>n.id===mutation.nodeId?{...n,...mutation.point}:n),edges,policy);}catch(error){notice(error instanceof Error?error.message:String(error));return Promise.resolve(false);}
  store.set(s=>({...s,notice:null}));return action.run(mutation.type,signal=>onMutation(mutation,signal),()=>{if(mutation.type==='connect')store.set(s=>({...s,source:null}));});};
 const connect=(from:GraphEndpoint,to:GraphEndpoint)=>run({type:'connect',from,to});
 const ports=nodes.flatMap(node=>[...node.outputs.map(port=>({node,port,kind:'output' as const})),...node.inputs.map(port=>({node,port,kind:'input' as const}))]);
 const source=local.sourceIdentity===identity&&local.source&&nodes.some(n=>n.id===local.source!.nodeId&&n.outputs.some(p=>p.id===local.source!.portId))?local.source:null;
 return <View {...props} style={[{gap:8,maxWidth:'100%'},props.style]}>
  <SegmentedControl aria-label="Node graph panel section" options={[{value:'graph',label:'Graph'},{value:'properties',label:'Node'},{value:'ports',label:'Ports'},{value:'links',label:'Links'},{value:'library',label:'Add'}]} value={local.section} onChange={section=>store.set(s=>({...s,section}))} unstyled={unstyled}/>
  {local.section==='graph'?<PatchGraph interactionBoundary={rendererKey} nodes={nodes} edges={edges} width={size.width} height={size.height} selectedNodeId={selectedNodeId} onSelectNode={id=>{if(!current.current.locked&&current.current.rendererKey===rendererKey)onSelectNode(id);}} onMoveNode={(nodeId,point)=>run({type:'move',nodeId,point})} onConnect={connect} onInvalidConnection={notice} disabled={locked} unstyled={unstyled} style={{width,height,maxWidth:'100%'}}/>:null}
  {local.section==='properties'?<ScrollView style={{height}} contentContainerStyle={{gap:8}} keyboardShouldPersistTaps="handled"><Select label="Selected graph node" value={selectedNodeId??''} options={nodes.map(n=>({value:n.id,label:n.title}))} disabled={locked} unstyled={unstyled} onValueChange={onSelectNode}/>{selected?<View style={{gap:8}}>
   <UnitInput scope={JSON.stringify([identity,selected.id,'x'])} label="Node X" value={selected.x} min={0} max={100000-(selected.width??200)} step={1} disabled={locked} unstyled={unstyled} onCommit={x=>run({type:'move',nodeId:selected.id,point:{x,y:selected.y}})}/>
   <UnitInput scope={JSON.stringify([identity,selected.id,'y'])} label="Node Y" value={selected.y} min={0} max={100000-58-Math.max(selected.inputs.length,selected.outputs.length)*44} step={1} disabled={locked} unstyled={unstyled} onCommit={y=>run({type:'move',nodeId:selected.id,point:{x:selected.x,y}})}/>
   <Button title={`Remove node ${selected.title}`} disabled={locked} unstyled={unstyled} onPress={()=>run({type:'remove',nodeId:selected.id})}/>
  </View>:<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Select a node to edit its position</Text>}</ScrollView>:null}
  {local.section==='ports'?<View style={{gap:6}}><Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{source?`Connecting ${source.nodeId}:${source.portId}`:'Select an output, then an input'}</Text>{source?<Button title="Cancel typed graph connection" unstyled={unstyled} onPress={()=>store.set(s=>({...s,source:null}))}/>:null}
   <FlatList data={ports} keyExtractor={p=>JSON.stringify([p.node.id,p.kind,p.port.id])} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Typed graph ports" renderItem={({item})=><Button title={`${item.kind==='output'?'Select output':'Connect input'} ${item.node.title}: ${item.port.label} (${item.port.dataType})`} disabled={locked} unstyled={unstyled} onPress={()=>{if(locked)return;if(item.kind==='output')store.set(s=>({...s,source:{nodeId:item.node.id,portId:item.port.id},sourceIdentity:identity}));else if(source)connect(source,{nodeId:item.node.id,portId:item.port.id});else notice('Select an output before connecting an input');}}/>}/>
  </View>:null}
  {local.section==='links'?<FlatList data={edges} keyExtractor={e=>e.id} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Graph links" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No graph links</Text>} renderItem={({item})=><Button title={`Disconnect ${item.from.nodeId}:${item.from.portId} to ${item.to.nodeId}:${item.to.portId}`} disabled={locked} unstyled={unstyled} onPress={()=>run({type:'disconnect',edgeId:item.id})}/>}/>:null}
  {local.section==='library'?<FlatList data={availableNodeTypes} keyExtractor={n=>n.id} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Available node types" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No node types supplied</Text>} renderItem={({item})=><Button title={`Add node ${item.label}`} disabled={locked||nodes.length>=100} unstyled={unstyled} onPress={()=>run({type:'add',typeId:item.id})}/>}/>:null}
  {action.pending!==null?<Button title="Cancel graph request" unstyled={unstyled} onPress={()=>{action.cancel();store.set(s=>({...s,epoch:s.epoch+1}));}}/>:null}<ErrorMessage {...(local.notice?.identity===identity?{message:local.notice.message}:action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
