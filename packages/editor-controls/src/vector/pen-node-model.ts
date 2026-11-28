/**
 * Pure geometry and command planning for {@linkcode PenNodeEditor} (B-21).
 * Every function returns new values; the host owns the path and applies the
 * resulting intents as Prism ops (setPathNode, insertPathNode / setPathNodes,
 * removePathNode, setNodeKind, setSubpathClosed).
 */
import {
  AVAILABLE,roundCoord,unavailable,
  type Availability,type HandleOffset,type NodeKind,type NodeRef,type PathNode,type Point,type Subpath,
} from "./vector-types.ts";

/** Most nodes the React Native overlay draws; larger paths need a GPU overlay. */
export const PEN_MAX_NODES=1000;
/** Every node and handle target is at least this many points square. */
export const PEN_TOUCH_TARGET=44;
/** Drawn node marker edge, in points. */
export const PEN_NODE_SIZE=12;
/** Drawn handle knob diameter, in points. */
export const PEN_HANDLE_SIZE=10;
/** How close (view points) a tap must land to a segment to insert a node there. */
export const PEN_INSERT_TOLERANCE=12;
/** Pointer travel (view points) under which a press on a node counts as a tap, not a drag. */
export const PEN_TAP_SLOP=3;

const KIND_LABELS={corner:"Corner",smooth:"Smooth",symmetric:"Symmetric"} as const satisfies Record<NodeKind,string>;
/** Every {@linkcode NodeKind} with its label, in the order the editor offers them. */
export const NODE_KINDS=[
  {value:"corner",label:"Corner"},{value:"smooth",label:"Smooth"},{value:"symmetric",label:"Symmetric"},
] as const satisfies readonly {value:NodeKind;label:string}[];
/** Label for a {@linkcode NodeKind}. */
export function nodeKindLabel(kind:NodeKind):string{
  return KIND_LABELS[kind];
}

/**
 * Throws a RangeError when the editor cannot draw `subpaths` honestly: no
 * subpaths, an empty subpath, non-finite coordinates, an unknown node kind,
 * or more than {@linkcode PEN_MAX_NODES} nodes.
 */
export function validateSubpaths(subpaths:readonly Subpath[]):void{
  if(subpaths.length>PEN_MAX_NODES)throw new RangeError("Too many subpaths");
  if(subpaths.length===0)throw new RangeError("A path needs at least one subpath");
  let total=0;
  subpaths.forEach((sp,i)=>{
    if(sp.nodes.length===0)throw new RangeError("Subpath "+i+" has no nodes");
    total+=sp.nodes.length;
    for(const n of sp.nodes){
      if(n.in!==undefined&&n.in.length!==2||n.out!==undefined&&n.out.length!==2)throw new RangeError("Path handles need two coordinates");
      const values=[n.x,n.y,...(n.in??[]),...(n.out??[])];
      if(!values.every(Number.isFinite))throw new RangeError("Path node coordinates must be finite");
      if(!Object.hasOwn(KIND_LABELS,n.kind))throw new RangeError("Unknown node kind: "+String(n.kind));
    }
  });
  if(total>PEN_MAX_NODES)throw new RangeError("Path exceeds "+PEN_MAX_NODES+" nodes for the overlay");
}
/** Whether `ref` points at an existing node. */
export function isNodeRef(subpaths:readonly Subpath[],ref:NodeRef|undefined):ref is NodeRef{
  return ref!==undefined&&Number.isInteger(ref.subpath)&&Number.isInteger(ref.index)&&
    ref.subpath>=0&&ref.subpath<subpaths.length&&ref.index>=0&&ref.index<subpaths[ref.subpath]!.nodes.length;
}
/** The node at `ref`. @throws RangeError when it does not exist. */
export function nodeAt(subpaths:readonly Subpath[],ref:NodeRef):PathNode{
  const node=isNodeRef(subpaths,ref)?subpaths[ref.subpath]!.nodes[ref.index]:undefined;
  if(!node)throw new RangeError("No node at "+ref.subpath+":"+ref.index);
  return node;
}
/** A copy of `subpaths` with the node at `ref` replaced. */
export function replaceNode(subpaths:readonly Subpath[],ref:NodeRef,node:PathNode):Subpath[]{
  nodeAt(subpaths,ref);
  return subpaths.map((sp,si)=>si!==ref.subpath?sp:{...sp,nodes:sp.nodes.map((n,i)=>i===ref.index?node:n)});
}

/** Number of segments in a subpath: one per node pair, plus the closing segment. */
export function segmentCount(sp:Subpath):number{
  const n=sp.nodes.length;
  if(n<2)return 0;
  return sp.closed?n:n-1;
}
/** Cubic control points of one segment, absolute content coordinates. `line` when neither handle is set. */
export interface SegmentControls {
  readonly p0:Point;
  readonly p1:Point;
  readonly p2:Point;
  readonly p3:Point;
  readonly line:boolean;
}
/** Controls of segment `segment` of `sp` (from node `segment` to the next node, wrapping when closed). */
export function segmentControls(sp:Subpath,segment:number):SegmentControls{
  if(!Number.isInteger(segment)||segment<0||segment>=segmentCount(sp))throw new RangeError("No segment "+segment);
  const a=sp.nodes[segment]!,b=sp.nodes[(segment+1)%sp.nodes.length]!;
  const p0={x:a.x,y:a.y},p3={x:b.x,y:b.y};
  const p1=a.out?{x:a.x+a.out[0],y:a.y+a.out[1]}:p0;
  const p2=b.in?{x:b.x+b.in[0],y:b.y+b.in[1]}:p3;
  return {p0,p1,p2,p3,line:!a.out&&!b.in};
}
/** Point on a segment at parameter `t` (0..1). */
export function pointOnSegment(c:SegmentControls,t:number):Point{
  const u=1-t;
  if(c.line)return {x:u*c.p0.x+t*c.p3.x,y:u*c.p0.y+t*c.p3.y};
  return {
    x:u*u*u*c.p0.x+3*u*u*t*c.p1.x+3*u*t*t*c.p2.x+t*t*t*c.p3.x,
    y:u*u*u*c.p0.y+3*u*u*t*c.p1.y+3*u*t*t*c.p2.y+t*t*t*c.p3.y,
  };
}
/**
 * Polyline approximation of a segment: one piece for a line, otherwise enough
 * pieces that none is longer than `maxPiece` units along the control polygon
 * (2..48 pieces). The overlay draws these; curves stay exact in the engine.
 */
export function sampleSegment(c:SegmentControls,maxPiece=8):Point[]{
  if(c.line)return [c.p0,c.p3];
  const hull=Math.hypot(c.p1.x-c.p0.x,c.p1.y-c.p0.y)+Math.hypot(c.p2.x-c.p1.x,c.p2.y-c.p1.y)+Math.hypot(c.p3.x-c.p2.x,c.p3.y-c.p2.y);
  const pieces=Math.min(48,Math.max(2,Math.ceil(hull/Math.max(1,maxPiece))));
  const out:Point[]=[];
  for(let i=0;i<=pieces;i++)out.push(pointOnSegment(c,i/pieces));
  return out;
}

/** Where a point lands nearest on a path. */
export interface PathHit {
  readonly subpath:number;
  readonly segment:number;
  /** Curve parameter 0..1 of the nearest point. */
  readonly t:number;
  readonly point:Point;
  readonly distance:number;
}
/**
 * Nearest point on any segment within `tolerance` of `p`, or `undefined`.
 * Pass points and tolerance in the same space (`project` maps content to it).
 */
export function hitPath(
  subpaths:readonly Subpath[],p:Point,tolerance:number,project:(q:Point)=>Point=q=>q,
):PathHit|undefined{
  let best:PathHit|undefined;
  subpaths.forEach((sp,si)=>{
    for(let s=0;s<segmentCount(sp);s++){
      const c=segmentControls(sp,s);
      const steps=c.line?1:64;
      const pts=Array.from({length:steps+1},(_,i)=>project(pointOnSegment(c,i/steps)));
      for(let i=0;i<steps;i++){
        const a=pts[i]!,b=pts[i+1]!;
        const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
        const local=len2===0?0:Math.min(1,Math.max(0,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
        const q={x:a.x+dx*local,y:a.y+dy*local};
        const d=Math.hypot(p.x-q.x,p.y-q.y);
        if(d<=tolerance&&(!best||d<best.distance))best={subpath:si,segment:s,t:(i+local)/steps,point:q,distance:d};
      }
    }
  });
  return best;
}

/** Result of {@linkcode splitSegment}: the node to insert and the whole path after the split. */
export interface InsertNodeIntent {
  readonly subpath:number;
  /** Insert position in the subpath's node array. */
  readonly index:number;
  readonly node:PathNode;
  /** The full path after the split, shape preserved. */
  readonly subpaths:Subpath[];
  /**
   * True when the split also shortened the neighbours' handles (a curved
   * segment). Then `insertPathNode` alone would change the curve; send
   * `setPathNodes` with {@linkcode InsertNodeIntent.subpaths} for one exact undo step.
   */
  readonly neighborsChanged:boolean;
}
const lerp=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const offset=(from:Point,to:Point):HandleOffset=>[roundCoord(to.x-from.x),roundCoord(to.y-from.y)];
const rounded=(p:Point):Point=>({x:roundCoord(p.x),y:roundCoord(p.y)});
/**
 * Splits segment `segment` of subpath `subpath` at `t` with de Casteljau, so
 * the drawn shape does not change. A straight segment gains a corner node; a
 * curve gains a smooth node and its neighbours' handles shrink to match.
 */
export function splitSegment(subpaths:readonly Subpath[],subpath:number,segment:number,t:number):InsertNodeIntent{
  const sp=subpaths[subpath];
  if(!sp)throw new RangeError("No subpath "+subpath);
  if(!(t>0&&t<1))throw new RangeError("Split parameter must be strictly between 0 and 1");
  const c=segmentControls(sp,segment);
  const n=sp.nodes.length;
  const nextIndex=(segment+1)%n;
  const index=segment+1;
  if(c.line){
    const node:PathNode={...rounded(lerp(c.p0,c.p3,t)),kind:"corner"};
    const nodes=[...sp.nodes.slice(0,index),node,...sp.nodes.slice(index)];
    return {subpath,index,node,neighborsChanged:false,subpaths:subpaths.map((s,i)=>i===subpath?{...s,nodes}:s)};
  }
  const p01=lerp(c.p0,c.p1,t),p12=lerp(c.p1,c.p2,t),p23=lerp(c.p2,c.p3,t);
  const p012=lerp(p01,p12,t),p123=lerp(p12,p23,t),mid=rounded(lerp(p012,p123,t));
  const node:PathNode={...mid,in:offset(mid,p012),out:offset(mid,p123),kind:"smooth"};
  const prev=sp.nodes[segment]!,next=sp.nodes[nextIndex]!;
  const prevNode:PathNode={...prev,out:offset(c.p0,p01)};
  const nextNode:PathNode={...next,in:offset(c.p3,p23)};
  const nodes=sp.nodes.map((nd,i)=>i===segment?prevNode:i===nextIndex?nextNode:nd);
  nodes.splice(index,0,node);
  return {subpath,index,node,neighborsChanged:true,subpaths:subpaths.map((s,i)=>i===subpath?{...s,nodes}:s)};
}

/** A node moved by `(dx, dy)`; its handles are offsets, so they travel with it. */
export function moveNode(node:PathNode,dx:number,dy:number):PathNode{
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new RangeError("Invalid node move");
  return {...node,x:roundCoord(node.x+dx),y:roundCoord(node.y+dy)};
}
/** Which handle of a node. */
export type HandleSide="in"|"out";
/**
 * A node with handle `side` set to `handle`, keeping the node's constraint:
 * a smooth node turns the other handle to stay collinear (its length kept),
 * a symmetric node mirrors it exactly, a corner node moves only this handle.
 * `breakHandles` (Alt) turns the node into a corner first.
 */
export function moveHandle(node:PathNode,side:HandleSide,handle:HandleOffset,breakHandles=false):PathNode{
  if(!handle.every(Number.isFinite))throw new RangeError("Invalid handle");
  const h:HandleOffset=[roundCoord(handle[0]),roundCoord(handle[1])];
  const other:HandleSide=side==="in"?"out":"in";
  const kind:NodeKind=breakHandles?"corner":node.kind;
  const next:{-readonly [K in keyof PathNode]:PathNode[K]}={...node,kind,[side]:h};
  const opposite=node[other];
  const len=Math.hypot(h[0],h[1]);
  if(kind==="symmetric")next[other]=[roundCoord(-h[0]),roundCoord(-h[1])];
  else if(kind==="smooth"&&opposite&&len>0){
    const keep=Math.hypot(opposite[0],opposite[1]);
    next[other]=[roundCoord(-h[0]/len*keep),roundCoord(-h[1]/len*keep)];
  }
  return next;
}

/** Result of {@linkcode convertNodeKind}. */
export interface NodeKindIntent {
  readonly subpath:number;
  readonly index:number;
  readonly kind:NodeKind;
  /** The node with `kind` set and handles made consistent with it. */
  readonly node:PathNode;
  /**
   * True when the handles changed too. Then send `setPathNode` with
   * {@linkcode NodeKindIntent.node}; otherwise `setNodeKind` is enough.
   */
  readonly handlesChanged:boolean;
}
const sameHandle=(a:HandleOffset|undefined,b:HandleOffset|undefined)=>
  a===b||(a!==undefined&&b!==undefined&&a[0]===b[0]&&a[1]===b[1]);
/**
 * Converts the node at `ref` to `kind`. Corner keeps the handles. Smooth makes
 * them collinear along their bisector; symmetric also equalizes their length.
 * A node without handles gets them from its neighbours (a third of the way to
 * each), so a converted node always shows something to drag.
 */
export function convertNodeKind(subpaths:readonly Subpath[],ref:NodeRef,kind:NodeKind):NodeKindIntent{
  if(!Object.hasOwn(KIND_LABELS,kind))throw new RangeError("Unknown node kind: "+String(kind));
  const node=nodeAt(subpaths,ref);
  const sp=subpaths[ref.subpath]!;
  const base={subpath:ref.subpath,index:ref.index,kind};
  if(kind==="corner")return {...base,node:{...node,kind},handlesChanged:false};
  const n=sp.nodes.length;
  const prev=ref.index>0?sp.nodes[ref.index-1]:sp.closed&&n>1?sp.nodes[n-1]:undefined;
  const next=ref.index<n-1?sp.nodes[ref.index+1]:sp.closed&&n>1?sp.nodes[0]:undefined;
  let inLen=node.in?Math.hypot(...node.in):prev?Math.hypot(prev.x-node.x,prev.y-node.y)/3:0;
  let outLen=node.out?Math.hypot(...node.out):next?Math.hypot(next.x-node.x,next.y-node.y)/3:0;
  // Direction of travel through the node: from the in handle (or previous node) toward the out handle (or next node).
  const back=node.in?{x:node.x+node.in[0],y:node.y+node.in[1]}:prev??node;
  const ahead=node.out?{x:node.x+node.out[0],y:node.y+node.out[1]}:next??node;
  let dx=ahead.x-back.x,dy=ahead.y-back.y;
  const len=Math.hypot(dx,dy);
  if(len===0)return {...base,node:{...node,kind},handlesChanged:false};
  dx/=len;dy/=len;
  if(kind==="symmetric"){
    const both=inLen>0&&outLen>0?(inLen+outLen)/2:Math.max(inLen,outLen);
    inLen=both;outLen=both;
  }
  const result:{-readonly [K in keyof PathNode]:PathNode[K]}={x:node.x,y:node.y,kind};
  if(inLen>0)result.in=[roundCoord(-dx*inLen),roundCoord(-dy*inLen)];
  if(outLen>0)result.out=[roundCoord(dx*outLen),roundCoord(dy*outLen)];
  return {...base,node:result,handlesChanged:!sameHandle(result.in,node.in)||!sameHandle(result.out,node.out)};
}

/** Whether node `ref` can be removed. A subpath keeps at least one node. */
export function removeAvailability(subpaths:readonly Subpath[],ref:NodeRef|undefined):Availability{
  if(!isNodeRef(subpaths,ref))return unavailable("Select a node first");
  return subpaths[ref.subpath]!.nodes.length>1?AVAILABLE:unavailable("A subpath keeps at least one node");
}
/** Whether a node can be inserted on the segment leaving node `ref`. */
export function insertAfterAvailability(subpaths:readonly Subpath[],ref:NodeRef|undefined):Availability{
  if(!isNodeRef(subpaths,ref))return unavailable("Select a node first");
  const sp=subpaths[ref.subpath]!;
  if(sp.nodes.length<2)return unavailable("This subpath has no segment yet");
  if(!sp.closed&&ref.index===sp.nodes.length-1)return unavailable("The last node of an open path has no segment after it");
  return AVAILABLE;
}
/** Whether the subpath holding `ref` can be closed or opened. */
export function closeAvailability(subpaths:readonly Subpath[],ref:NodeRef|undefined):Availability{
  if(!isNodeRef(subpaths,ref))return unavailable("Select a node first");
  const sp=subpaths[ref.subpath]!;
  return sp.closed||sp.nodes.length>=2?AVAILABLE:unavailable("Add a second node before closing this path");
}
/** Whether the node at `ref` can change kind. */
export function kindAvailability(subpaths:readonly Subpath[],ref:NodeRef|undefined):Availability{
  return isNodeRef(subpaths,ref)?AVAILABLE:unavailable("Select a node first");
}

/** The node selected after Tab-like stepping by `direction` through every node of every subpath, wrapping. */
export function stepSelection(subpaths:readonly Subpath[],ref:NodeRef|undefined,direction:-1|1):NodeRef{
  const flat=subpaths.flatMap((sp,si)=>sp.nodes.map((_,i)=>({subpath:si,index:i})));
  if(flat.length===0)throw new RangeError("Path has no nodes");
  const at=ref?flat.findIndex(r=>r.subpath===ref.subpath&&r.index===ref.index):-1;
  if(at<0)return direction>0?flat[0]!:flat[flat.length-1]!;
  return flat[(at+direction+flat.length)%flat.length]!;
}

const num=(v:number)=>String(Math.round(v*10)/10);
/**
 * Screen-reader label for a node: position in its subpath, kind, coordinates
 * and handles, e.g. "Node 2 of 4, smooth, x 120, y 80, 2 handles".
 */
export function nodeAccessibilityLabel(subpaths:readonly Subpath[],ref:NodeRef):string{
  const node=nodeAt(subpaths,ref);
  const sp=subpaths[ref.subpath]!;
  const handles=(node.in?1:0)+(node.out?1:0);
  return [
    `Node ${ref.index+1} of ${sp.nodes.length}`,
    subpaths.length>1?`subpath ${ref.subpath+1} of ${subpaths.length}`:undefined,
    KIND_LABELS[node.kind].toLowerCase(),
    `x ${num(node.x)}, y ${num(node.y)}`,
    handles===0?"no handles":handles===1?"1 handle":"2 handles",
    sp.closed?undefined:ref.index===0?"start of open path":ref.index===sp.nodes.length-1?"end of open path":undefined,
  ].filter(Boolean).join(", ");
}
