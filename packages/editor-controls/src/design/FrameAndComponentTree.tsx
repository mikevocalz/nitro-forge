import {OutlineTree,type OutlineTreeProps} from '../inputs/OutlineTree.tsx';
export interface DesignTreeNode {id:string;parentId:string|null;name:string;kind:'frame'|'component'|'instance'|'group'|'layer';visible:boolean;locked:boolean;componentId?:string;unavailableReason?:string}
export interface FrameAndComponentTreeProps extends Omit<OutlineTreeProps,'nodes'|'label'> {nodes:readonly DesignTreeNode[]}
/** One hierarchy owner with native focus, expansion and virtualization. */
export function FrameAndComponentTree({nodes,...props}:FrameAndComponentTreeProps){
 const components=new Set(nodes.filter(n=>n.kind==='component').map(n=>n.id));
 if(nodes.some(n=>!['frame','component','instance','group','layer'].includes(n.kind)||n.kind==='instance'&&(!n.componentId||!components.has(n.componentId))))throw new RangeError('Invalid design component references');
 return <OutlineTree {...props} label="Frames and components" nodes={nodes.map(n=>({id:n.id,parentId:n.parentId,label:n.name,description:[n.kind,n.visible?'visible':'hidden',n.locked?'locked':'editable',n.componentId?'instance of '+n.componentId:''].filter(Boolean).join(', '),disabledReason:n.unavailableReason}))}/>;
}
