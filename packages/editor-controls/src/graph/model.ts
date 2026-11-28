/** Engine-neutral graph contract. UI handles interaction, never owns DSP or scene evaluation. */
export type GraphPoint=Readonly<{x:number;y:number}>;
export type GraphPort=Readonly<{id:string;label:string;dataType:string}>;
export type GraphNode=Readonly<{
 id:string;title:string;x:number;y:number;width?:number;
 inputs:readonly GraphPort[];outputs:readonly GraphPort[];
}>;
export type GraphEndpoint=Readonly<{nodeId:string;portId:string}>;
export type GraphEdge=Readonly<{id:string;from:GraphEndpoint;to:GraphEndpoint}>;
export type GraphSelection=Readonly<{nodeId:string;portId:string;dataType:string}>;
/** Node title bar height. */
export const GRAPH_HEADER_HEIGHT=44;
/** Port rows are full 44pt touch targets; wire anchors use the same metric. */
export const GRAPH_PORT_ROW_HEIGHT=44;

export function validatePatchGraph(nodes:readonly GraphNode[],edges:readonly GraphEdge[]):void{
 if(nodes.length>100||edges.length>200)throw new RangeError("Graph is beyond bounded RN preview budget");
 const byId=new Map<string,GraphNode>();
 for(const node of nodes){
   if(!node.id||byId.has(node.id)||!Number.isFinite(node.x)||!Number.isFinite(node.y))throw new Error("Invalid graph node: "+node.id);
   if(!Number.isFinite(node.width??200)||(node.width??200)<120||(node.width??200)>4000)throw new Error("Node width below minimum: "+node.id);
   if(!node.id.trim()||node.id.length>256||!node.title.trim()||node.title.length>512||node.inputs.length>64||node.outputs.length>64)throw new Error("Invalid graph node metadata: "+node.id);
   const ports=[...node.inputs,...node.outputs];
   if(new Set(ports.map(p=>p.id)).size!==ports.length||ports.some(p=>!p.id.trim()||p.id.length>256||!p.dataType.trim()||p.dataType.length>128||!p.label.trim()||p.label.length>512))throw new Error("Invalid graph ports: "+node.id);
   byId.set(node.id,node);
 }
 const seen=new Set<string>();
 for(const edge of edges){
  if(!edge.id.trim()||edge.id.length>256||seen.has(edge.id))throw new Error("Duplicate graph edge: "+edge.id);
  seen.add(edge.id);
  const output=byId.get(edge.from.nodeId)?.outputs.find(p=>p.id===edge.from.portId);
  const input=byId.get(edge.to.nodeId)?.inputs.find(p=>p.id===edge.to.portId);
  if(!output||!input||output.dataType!==input.dataType)throw new Error("Invalid or incompatible graph edge: "+edge.id);
 }
}
export function getPortAnchor(node:GraphNode,portId:string,kind:"input"|"output"):GraphPoint{
 const ports=kind==="input"?node.inputs:node.outputs;
 const index=ports.findIndex(p=>p.id===portId);
 if(index<0)throw new RangeError("Unknown port: "+portId);
 return {x:node.x+(kind==="output"?(node.width??200)-6:6),y:node.y+GRAPH_HEADER_HEIGHT+GRAPH_PORT_ROW_HEIGHT*index+GRAPH_PORT_ROW_HEIGHT/2};
}
export function cubicGraphPoints(from:GraphPoint,to:GraphPoint,segments=16):GraphPoint[]{
 if(!Number.isInteger(segments)||segments<1||segments>64)throw new RangeError("Invalid curve segments");
 const handle=Math.max(30,Math.abs(to.x-from.x)*0.5);
 const c1={x:from.x+handle,y:from.y},c2={x:to.x-handle,y:to.y};
 const out:GraphPoint[]=[];
 for(let i=0;i<=segments;i++){
  const t=i/segments,u=1-t;
  out.push({
   x:u*u*u*from.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*to.x,
   y:u*u*u*from.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*to.y,
  });
 }
 return out;
}
export function compatiblePorts(output:GraphSelection,input:GraphSelection):boolean{
 return output.nodeId!==input.nodeId && output.dataType===input.dataType;
}
