import {OutlineTree,type OutlineTreeProps} from '../inputs/OutlineTree.tsx';
export interface PDFBookmark {id:string;parentId:string|null;label:string;destination:{pageId:string;x?:number;y?:number;zoom?:number};disabledReason?:string}
export interface BookmarkOutlineProps extends Omit<OutlineTreeProps,'label'|'nodes'|'onSelect'> {
 bookmarks:readonly PDFBookmark[];onJump:(destination:PDFBookmark['destination'],signal?:AbortSignal)=>unknown;
}
export function BookmarkOutline({bookmarks,onJump,...props}:BookmarkOutlineProps){
 if(bookmarks.some(b=>!b.destination.pageId.trim()||b.destination.pageId.length>256||[b.destination.x,b.destination.y,b.destination.zoom].some(n=>n!==undefined&&!Number.isFinite(n))||b.destination.zoom!==undefined&&b.destination.zoom<=0))throw new RangeError('Invalid PDF bookmark destination');
 return <OutlineTree {...props} label="PDF bookmarks" nodes={bookmarks.map(b=>({id:b.id,parentId:b.parentId,label:b.label,description:'Destination '+b.destination.pageId,disabledReason:b.disabledReason}))} onSelect={(id,s)=>{const b=bookmarks.find(b=>b.id===id);if(b&&b.disabledReason===undefined)return onJump(b.destination,s);}}/>;
}
