import {useLayoutEffect,useRef} from 'react';
import {PenNodeEditor,type PenNodeEditorProps} from '../vector/PenNodeEditor.tsx';
import {replaceNode,validateSubpaths} from '../vector/pen-node-model.ts';
import type {NodeRef,Subpath} from '../vector/vector-types.ts';
import {snapMotionPoint,snapMotionTangent,validateMotionPathSnapping,type MotionPathSnapping} from './motion-path.ts';
export type {MotionPathSnapping} from './motion-path.ts';
export type {NodeRef,Subpath,PathNode,ViewTransform} from '../vector/vector-types.ts';
export interface MotionPathEditorProps extends Omit<PenNodeEditorProps,'subpaths'|'selection'|'onSelectionChange'|'onSetPathNode'|'onInsertNode'|'onRemoveNode'|'onSetNodeKind'|'onSetClosed'|'snapPoint'|'snapHandle'|'editScope'|'editRevision'> {
 readonly scope:string;readonly revision:string|number;readonly subpaths:readonly Subpath[];readonly selection:NodeRef|undefined;readonly onSelectionChange:(selection:NodeRef|undefined)=>void;
 readonly snapping:MotionPathSnapping;
 readonly onCommit:(subpaths:readonly Subpath[])=>void;
}
/** Spatial trajectory editing reuses the vector editor's native gesture, tangent and keyboard owner. */
export function MotionPathEditor({scope,revision,subpaths,selection,onSelectionChange,snapping,onCommit,onPreview,...props}:MotionPathEditorProps){
 if(!scope.trim()||typeof revision==='number'&&!Number.isFinite(revision))throw new RangeError('Invalid motion path identity');validateSubpaths(subpaths);validateMotionPathSnapping(snapping);
 const identity=JSON.stringify([scope,revision]),committed=useRef<string|null>(null);useLayoutEffect(()=>{committed.current=identity;return()=>{committed.current=null;};},[identity]);
 const commit=(next:readonly Subpath[])=>{if(committed.current!==identity)return;validateSubpaths(next);onCommit(next);};
 return <PenNodeEditor {...props} key={scope} editScope={scope} editRevision={revision} subpaths={subpaths} selection={selection} onSelectionChange={value=>{if(committed.current===identity)onSelectionChange(value);}} onPreview={value=>{if(value===undefined||committed.current===identity)onPreview?.(value);}}
  snapPoint={point=>snapMotionPoint(point,snapping)} snapHandle={offset=>snapMotionTangent(offset,snapping.tangentAngleDegrees)}
  onSetPathNode={intent=>commit(replaceNode(subpaths,intent,intent.node))} onInsertNode={intent=>commit(intent.subpaths)} onSetNodeKind={intent=>commit(replaceNode(subpaths,intent,intent.node))}
  onRemoveNode={ref=>commit(subpaths.map((path,index)=>index!==ref.subpath?path:{...path,nodes:path.nodes.filter((_,i)=>i!==ref.index)}))}
  onSetClosed={intent=>commit(subpaths.map((path,index)=>index!==intent.subpath?path:{...path,closed:intent.closed}))}/>;
}
