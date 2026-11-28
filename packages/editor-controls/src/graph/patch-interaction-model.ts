import type {GraphNode,GraphPoint,GraphSelection} from './model.ts';
/** Ephemeral interaction identity is separate from React/native view identity. */
export function graphInteractionBoundary(scope:string|number,nodes:readonly GraphNode[],edges:unknown,width:number,height:number,scale:number,disabled:boolean):string{
 return JSON.stringify([scope,nodes,edges,width,height,scale,disabled]);
}
export function currentGraphOutput(nodes:readonly GraphNode[],output:GraphSelection|null):GraphSelection|null{
 if(!output)return null;
 const port=nodes.find(n=>n.id===output.nodeId)?.outputs.find(p=>p.id===output.portId);
 return port?.dataType===output.dataType?output:null;
}
/** Own async outcomes without retaining an optimistic position after release. */
export function createGraphRequests(){
 let generation=0,active=true;
 return {
  invalidate(){generation++;},
  activate(){active=true;},deactivate(){active=false;generation++;},
  async run(operation:()=>unknown,onError:(message:string)=>void):Promise<boolean>{
   const admitted=++generation;
   try{const result=await operation();return active&&admitted===generation&&result!==false;}
   catch(error){if(active&&admitted===generation)onError(error instanceof Error?error.message:String(error));return false;}
  },
 };
}
export function graphDragPoint(start:GraphPoint,dx:number,dy:number,scale:number):GraphPoint{
 return{x:Math.max(0,start.x+dx/scale),y:Math.max(0,start.y+dy/scale)};
}

/** Preview belongs only to the exact current authoritative geometry/gesture boundary. */
export function graphDisplayedNodes(nodes:readonly GraphNode[],positions:Readonly<Record<string,GraphPoint>>,previewBoundary:string|null,currentBoundary:string):readonly GraphNode[]{
 return nodes.map(node=>({...node,...(previewBoundary===currentBoundary?positions[node.id]:undefined)}));
}
