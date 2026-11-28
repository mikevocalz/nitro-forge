import {forgeRadius} from "../radius.ts";
import {useMemo,useRef,useLayoutEffect} from "react";
import {PanResponder,Pressable,ScrollView,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {compatiblePorts,cubicGraphPoints,getPortAnchor,validatePatchGraph,
 GRAPH_HEADER_HEIGHT,GRAPH_PORT_ROW_HEIGHT,
 type GraphNode,type GraphEdge,type GraphPoint,type GraphSelection} from "./model.ts";
import {createCanvasResponder} from "@nyc-tron/ui/components/gestures/canvas-responder";
import {ErrorMessage} from "@nyc-tron/ui/components/feedback/ErrorMessage";
import {createGraphRequests,currentGraphOutput,graphInteractionBoundary,graphDragPoint,graphDisplayedNodes} from "./patch-interaction-model.ts";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

type Local={positions:Readonly<Record<string,GraphPoint>>;output:GraphSelection|null;error:string|null};
export interface PatchGraphProps extends Omit<ViewProps,"children">{
 nodes:readonly GraphNode[];
 edges:readonly GraphEdge[];
 width:number;
 height:number;
 disabled?:boolean;
 scrollEnabled?:boolean;
 interactionScale?:number;
 /** Geometry/source changes cancel gestures without replacing focused native views. */
 interactionBoundary?:string|number;
 onInteractionError?:(message:string)=>void;
 onInvalidConnection?:(message:string)=>void;
 selectedNodeId?:string|null;
 onSelectNode?:(id:string)=>void;
 onMoveNode?:(id:string,point:GraphPoint)=>void|Promise<unknown>;
 onConnect?:(from:{nodeId:string;portId:string},to:{nodeId:string;portId:string})=>void|Promise<unknown>;
 /** Optional override; defaults to the theme's accent token. */
 accentColor?:string;
 className?:string;
 unstyled?:boolean;
}
/** Native RN graph interaction surface. GPU wire renderer required beyond preview-sized graphs. */
export function PatchGraph({
 nodes,edges,width,height,disabled=false,scrollEnabled=true,interactionScale=1,interactionBoundary="graph",onInteractionError,onInvalidConnection,selectedNodeId,onSelectNode,onMoveNode,onConnect,
 accentColor,className,unstyled=false,...rest
}:PatchGraphProps){
 const local=useRef<StoreApi<Local>|null>(null);
 if(!local.current)local.current=createStore<Local>(()=>({positions:{},output:null,error:null}));
 const store=local.current;
 const positions=useStore(store,s=>s.positions),pendingOutput=useStore(store,s=>s.output),error=useStore(store,s=>s.error);
 const boundary=graphInteractionBoundary(interactionBoundary,nodes,edges,width,height,interactionScale,disabled);
 const requests=useRef<ReturnType<typeof createGraphRequests>|null>(null);requests.current??=createGraphRequests();
 const committed=useRef<string|null>(null);
 useLayoutEffect(()=>{committed.current=boundary;requests.current!.invalidate();store.setState({positions:{},output:null,error:null});return()=>{committed.current=null;requests.current!.invalidate();};},[boundary,store]);
 useLayoutEffect(()=>{requests.current!.activate();return()=>requests.current!.deactivate();},[]);
 const current=()=>committed.current===boundary&&!disabled;
 const output=currentGraphOutput(nodes,pendingOutput);
 const rendered=useMemo(()=>graphDisplayedNodes(nodes,positions,committed.current,boundary),[nodes,positions,boundary]);
 const report=(message:string)=>{store.setState({error:message});onInteractionError?.(message);};
 validatePatchGraph(rendered,edges);if(!Number.isFinite(interactionScale)||interactionScale<=0)throw new RangeError("Invalid graph interaction scale");
 const byId=new Map(rendered.map(n=>[n.id,n] as const));
 const selectOutput=(port:GraphSelection)=>{if(current())store.setState({output:port,error:null});};
 const selectInput=(input:GraphSelection)=>{
  if(!current())return;
  if(output&&compatiblePorts(output,input)){
   void requests.current!.run(()=>onConnect?.({nodeId:output.nodeId,portId:output.portId},{nodeId:input.nodeId,portId:input.portId}),report);
   store.setState({output:null});
  }else onInvalidConnection?.(output?"Ports must have matching types and belong to different nodes":"Select an output before connecting an input");
 };
 const previewMove=(id:string,point:GraphPoint|undefined)=>{if(current())store.setState(s=>{const positions={...s.positions};if(point)positions[id]=point;else delete positions[id];return{positions};});};
 const commitMove=(id:string,point:GraphPoint)=>{
  previewMove(id,undefined);
  if(current())void requests.current!.run(()=>onMoveNode?.(id,point),report);
 };
 const cancelPending=()=>store.setState({output:null});
 const styled=!unstyled;
 return <View {...rest} {...{className:joinClasses("overflow-hidden",!unstyled&&"rounded-control bg-surface-sunken",className)}}>
  <ScrollView horizontal nestedScrollEnabled scrollEnabled={scrollEnabled}>
   <ScrollView nestedScrollEnabled scrollEnabled={scrollEnabled}>
    <View style={{width,height,minWidth:width,minHeight:height}}>
     {edges.flatMap(edge=>{
       const from=byId.get(edge.from.nodeId)!,to=byId.get(edge.to.nodeId)!;
       const points=cubicGraphPoints(getPortAnchor(from,edge.from.portId,"output"),getPortAnchor(to,edge.to.portId,"input"),16);
       return points.slice(1).map((p,i)=>{
         const prev=points[i]!,dx=p.x-prev.x,dy=p.y-prev.y,len=Math.hypot(dx,dy);
         return <View key={edge.id+"-"+i} pointerEvents="none"
           {...{className:joinClasses(styled&&!accentColor&&"bg-accent")}} style={{position:"absolute",left:(p.x+prev.x-len)/2,
           top:(p.y+prev.y)/2-tokens.borderWidth.hairline,width:len,height:tokens.spacing.off2,...(accentColor?{backgroundColor:accentColor}:null),
           transform:[{rotate:Math.atan2(dy,dx)*180/Math.PI+"deg"}]}}/>;
       });
     })}
     {rendered.map(node=><PatchNode key={node.id} node={node} boundary={boundary} interactionScale={interactionScale} selected={selectedNodeId===node.id} disabled={disabled}
       accentColor={accentColor} styled={styled} pendingOutput={output?.nodeId===node.id?output.portId:null}
       onSelect={()=>{if(!disabled)onSelectNode?.(node.id);}} onPreview={point=>previewMove(node.id,point)}
       onCommit={point=>commitMove(node.id,point)}
       onOutput={portId=>selectOutput({nodeId:node.id,portId,
         dataType:node.outputs.find(p=>p.id===portId)!.dataType})}
       onInput={portId=>selectInput({nodeId:node.id,portId,
         dataType:node.inputs.find(p=>p.id===portId)!.dataType})}/>)}
    </View>
   </ScrollView>
  </ScrollView>
  {output?<Pressable accessibilityRole="button" accessibilityLabel="Cancel cable connection"
    onPress={cancelPending} style={{minHeight:tokens.spacing.fixedTarget,justifyContent:"center",paddingHorizontal:tokens.spacing.fixedInset}}>
      <Text {...{className:joinClasses(styled&&"text-text")}}>Connecting {output.nodeId}:{output.portId} · Tap an input, or cancel</Text>
    </Pressable>:null}
  <ErrorMessage {...exact({message:error??undefined,unstyled:unstyled})}/>
 </View>;
}
type PatchNodeProps={
 node:GraphNode;boundary:string;interactionScale:number;disabled:boolean;selected:boolean;accentColor:string|undefined;styled:boolean;pendingOutput:string|null;
 onSelect:()=>void;onPreview:(p:GraphPoint|undefined)=>void;onCommit:(p:GraphPoint)=>void;
 onInput:(portId:string)=>void;onOutput:(portId:string)=>void;
};
function PatchNode({node,boundary,interactionScale,disabled,selected,accentColor,styled,pendingOutput,onSelect,onPreview,onCommit,onInput,onOutput}:PatchNodeProps){
 const latest=useRef({node,boundary,interactionScale,disabled,onSelect,onPreview,onCommit});
 latest.current={node,boundary,interactionScale,disabled,onSelect,onPreview,onCommit};
 const admitted=useRef<string|null>(null);
 useLayoutEffect(()=>{admitted.current=null;cancelled.current=true;},[boundary]);
 const start=useRef<GraphPoint>({x:node.x,y:node.y});
 const active=useRef(false),cancelled=useRef(false);
 useLayoutEffect(()=>{active.current=true;return()=>{active.current=false;cancelled.current=true;};},[]);
 const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
 if(!pan.current)pan.current=createCanvasResponder({
  onStartShouldSetPanResponder:e=>!latest.current.disabled&&(e.nativeEvent.touches?.length??1)<=1,
  onMoveShouldSetPanResponder:()=>!latest.current.disabled,
  onPanResponderGrant:()=>{admitted.current=latest.current.boundary;cancelled.current=false;start.current={x:latest.current.node.x,y:latest.current.node.y};},
  onPanResponderMove:(_e,g)=>{if(!active.current||admitted.current!==latest.current.boundary||latest.current.disabled||cancelled.current)return;if(g.numberActiveTouches>1){cancelled.current=true;latest.current.onPreview(undefined);return;}latest.current.onPreview(graphDragPoint(start.current,g.dx,g.dy,latest.current.interactionScale));},
  onPanResponderRelease:(_e,g)=>{
    if(!active.current||admitted.current!==latest.current.boundary||latest.current.disabled||cancelled.current)return;
    cancelled.current=true;admitted.current=null;
    if(Math.abs(g.dx)+Math.abs(g.dy)<4){latest.current.onPreview(undefined);latest.current.onSelect();}
    else latest.current.onCommit(graphDragPoint(start.current,g.dx,g.dy,latest.current.interactionScale));
  },
  onPanResponderTerminationRequest:()=>false,
  onPanResponderTerminate:()=>{cancelled.current=true;if(active.current)latest.current.onPreview(undefined);},
 });
 const w=node.width??200;
 const height=GRAPH_HEADER_HEIGHT+14+Math.max(node.inputs.length,node.outputs.length)*GRAPH_PORT_ROW_HEIGHT;
 const portRing=<View style={{width:tokens.spacing.fixedInset,height:tokens.spacing.fixedInset,borderRadius:forgeRadius.sm,borderWidth:tokens.borderWidth.strong,...(accentColor?{borderColor:accentColor}:null)}}
   {...{className:joinClasses(styled&&!accentColor&&"border-accent")}}/>;
 const portLabel=joinClasses(styled&&"text-text-muted");
 // A View with pan handlers has no onPress, so the screen-reader activate
 // gesture needs its own handler or selection is unreachable without touch.
 return <View {...{className:joinClasses(styled&&"rounded-control bg-surface-raised",
     styled&&(selected?(accentColor?undefined:"border-accent"):"border-border"))}}
   style={{position:"absolute",left:node.x,top:node.y,width:w,minHeight:height,
   borderWidth:selected?tokens.borderWidth.strong:tokens.borderWidth.hairline,...(selected&&accentColor?{borderColor:accentColor}:null),overflow:"hidden"}}>
   <View {...pan.current.panHandlers} accessible accessibilityRole="button"
     accessibilityLabel={node.title}
     accessibilityHint="Drag to move. Double tap to select."
     accessibilityState={{selected,disabled}}
     onAccessibilityTap={()=>{if(!disabled)onSelect();}}
     accessibilityActions={[{name:"activate"}]}
     onAccessibilityAction={e=>{if(!disabled&&e.nativeEvent.actionName==="activate")onSelect();}}
     {...{className:joinClasses(styled&&"bg-surface-sunken")}}
     style={{height:GRAPH_HEADER_HEIGHT,justifyContent:"center",paddingHorizontal:tokens.spacing.fixedInset}}>
     <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontWeight:tokens.fontWeight.bold}}>{node.title}</Text>
   </View>
   <View style={{flexDirection:"row",justifyContent:"space-between"}}>
    <View style={{flex:1}}>
     {node.inputs.map(p=><Pressable key={p.id} accessibilityRole="button" disabled={disabled}
       accessibilityLabel={"Connect input "+p.label+" ("+p.dataType+")"}
       onPress={()=>onInput(p.id)}
       style={{height:GRAPH_PORT_ROW_HEIGHT,flexDirection:"row",alignItems:"center",gap:tokens.spacing.off6,paddingLeft:tokens.spacing.off2}}>
       {portRing}
       <Text numberOfLines={1} {...{className:portLabel}} style={{fontSize:tokens.text.off11}}>{p.label}</Text>
     </Pressable>)}
    </View>
    <View style={{flex:1}}>
     {node.outputs.map(p=><Pressable key={p.id} accessibilityRole="button" disabled={disabled}
       accessibilityLabel={"Select output "+p.label+" ("+p.dataType+")"}
       accessibilityState={{selected:pendingOutput===p.id,disabled}}
       onPress={()=>onOutput(p.id)}
       style={{height:GRAPH_PORT_ROW_HEIGHT,flexDirection:"row",alignItems:"center",justifyContent:"flex-end",gap:tokens.spacing.off6,paddingRight:tokens.spacing.off2}}>
       <Text numberOfLines={1} {...{className:portLabel}} style={{fontSize:tokens.text.off11}}>{p.label}</Text>
       {portRing}
     </Pressable>)}
    </View>
   </View>
 </View>;
}
