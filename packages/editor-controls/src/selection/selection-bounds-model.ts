import type {DocPoint} from '../canvas/canvas-viewport.ts';
import {anchorPoint,contentToDoc,rotationFromDrag,snapRotation,type BoundsCorners,type OriginAnchor} from '../canvas/transform-origin-model.ts';
/** Clockwise document-space rectangle. Hosts apply edits to their own document/selection. */
export interface SelectionFrame {centerX:number;centerY:number;width:number;height:number;rotation:number}
export const RESIZE_HANDLES=['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left'] as const;
export type ResizeHandle=typeof RESIZE_HANDLES[number];
export type SelectionHandle=ResizeHandle|'move'|'rotate';
const direction:Record<ResizeHandle,readonly[number,number]>={'top-left':[-1,-1],top:[0,-1],'top-right':[1,-1],right:[1,0],'bottom-right':[1,1],bottom:[0,1],'bottom-left':[-1,1],left:[-1,0]};
export interface SelectionEditLimits {minWidth?:number;minHeight?:number;maxWidth?:number;maxHeight?:number;lockAspect?:boolean;snapAngle?:boolean}
export function validateSelectionFrame(frame:SelectionFrame):void{
 if(![frame.centerX,frame.centerY,frame.width,frame.height,frame.rotation].every(Number.isFinite)||frame.width<=0||frame.height<=0)throw new RangeError('Selection frame must have finite coordinates and positive size');
}
const validatePoint=(p:DocPoint)=>{if(![p.x,p.y].every(Number.isFinite))throw new RangeError('Selection point must be finite');};
const rotate=(x:number,y:number,degrees:number):DocPoint=>{const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);return {x:c*x-s*y,y:s*x+c*y};};
const transform=(frame:SelectionFrame)=>({tx:0,ty:0,sx:1,sy:1,rotation:frame.rotation,ox:frame.centerX,oy:frame.centerY});
export function selectionFrameCorners(frame:SelectionFrame):BoundsCorners{
 validateSelectionFrame(frame);const t=transform(frame);
 return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{const p=contentToDoc(t,{x:frame.centerX+x!*frame.width/2,y:frame.centerY+y!*frame.height/2});validatePoint(p);return [p.x,p.y];}) as unknown as BoundsCorners;
}
export function selectionHandlePoint(frame:SelectionFrame,handle:SelectionHandle,rotationGap=32):DocPoint{
 validateSelectionFrame(frame);if(!Number.isFinite(rotationGap)||rotationGap<0)throw new RangeError('Invalid rotation handle gap');
 if(handle==='move')return {x:frame.centerX,y:frame.centerY};
 if(handle==='rotate')return contentToDoc(transform(frame),{x:frame.centerX,y:frame.centerY-frame.height/2-rotationGap});
 if(!RESIZE_HANDLES.includes(handle))throw new RangeError('Unknown selection handle');
 return anchorPoint(selectionFrameCorners(frame),handle as OriginAnchor);
}
/** Handle-first hit testing. The body moves; no screen/RTL mirroring changes document geometry. */
export function hitTestSelection(frame:SelectionFrame,point:DocPoint,radius:number,rotationGap=32):SelectionHandle|undefined{
 validateSelectionFrame(frame);validatePoint(point);if(!Number.isFinite(radius)||radius<0)throw new RangeError('Invalid hit radius');
 let nearest:{handle:SelectionHandle;distance:number}|undefined;
 for(const handle of [...RESIZE_HANDLES,'rotate'] as const){const p=selectionHandlePoint(frame,handle,rotationGap),distance=Math.hypot(point.x-p.x,point.y-p.y);if(distance<=radius&&(!nearest||distance<nearest.distance))nearest={handle,distance};}
 if(nearest)return nearest.handle;
 const local=rotate(point.x-frame.centerX,point.y-frame.centerY,-frame.rotation);
 return Math.abs(local.x)<=frame.width/2&&Math.abs(local.y)<=frame.height/2?'move':undefined;
}
/** Absolute drag from its captured frame. Resize keeps the opposite corner/edge fixed. */
export function editSelectionFrame(frame:SelectionFrame,handle:SelectionHandle,from:DocPoint,to:DocPoint,{minWidth=.01,minHeight=.01,maxWidth=1e12,maxHeight=1e12,lockAspect=false,snapAngle=false}:SelectionEditLimits={}):SelectionFrame{
 validateSelectionFrame(frame);validatePoint(from);validatePoint(to);
 if(![minWidth,minHeight,maxWidth,maxHeight].every(Number.isFinite)||minWidth<=0||minHeight<=0||maxWidth<minWidth||maxHeight<minHeight)throw new RangeError('Invalid selection size limits');
 let result:SelectionFrame;
 if(handle==='move')result={...frame,centerX:frame.centerX+to.x-from.x,centerY:frame.centerY+to.y-from.y};
 else if(handle==='rotate')result={...frame,rotation:Math.hypot(from.x-frame.centerX,from.y-frame.centerY)<1e-9||Math.hypot(to.x-frame.centerX,to.y-frame.centerY)<1e-9?frame.rotation:rotationFromDrag({x:frame.centerX,y:frame.centerY},from,to,frame.rotation,snapAngle)};
 else{
  if(!RESIZE_HANDLES.includes(handle))throw new RangeError('Unknown selection handle');
  const [x,y]=direction[handle],delta=rotate(to.x-from.x,to.y-from.y,-frame.rotation);
  let width=x?Math.max(minWidth,Math.min(maxWidth,frame.width+x*delta.x)):frame.width,height=y?Math.max(minHeight,Math.min(maxHeight,frame.height+y*delta.y)):frame.height;
  if(lockAspect){const lower=Math.max(minWidth/frame.width,minHeight/frame.height),upper=Math.min(maxWidth/frame.width,maxHeight/frame.height);if(lower>upper)throw new RangeError('Aspect ratio cannot satisfy selection size limits');const dw=x*delta.x/frame.width,dh=y*delta.y/frame.height,change=!x?dh:!y?dw:Math.abs(dw)>=Math.abs(dh)?dw:dh;const factor=Math.max(lower,Math.min(upper,1+change));width=frame.width*factor;height=frame.height*factor;}
  const centerDelta=rotate(x*(width-frame.width)/2,y*(height-frame.height)/2,frame.rotation);
  result={...frame,width,height,centerX:frame.centerX+centerDelta.x,centerY:frame.centerY+centerDelta.y};
 }
 validateSelectionFrame(result);return result;
}
/** Accessible step without synthesizing a drag pointer. */
export function stepSelectionFrame(frame:SelectionFrame,handle:SelectionHandle,dx:number,dy:number,limits:SelectionEditLimits={}):SelectionFrame{
 if(![dx,dy].every(Number.isFinite))throw new RangeError('Invalid selection step');
 if(handle==='rotate'){const result={...frame,rotation:snapRotation(frame.rotation+dx+(dy===0?0:dy),limits.snapAngle)};validateSelectionFrame(result);return result;}
 const from=selectionHandlePoint(frame,handle);return editSelectionFrame(frame,handle,from,{x:from.x+dx,y:from.y+dy},limits);
}

/** Outward document-space step for a resize handle, including the frame's rotation. */
export function selectionResizeDirection(frame:SelectionFrame,handle:ResizeHandle):DocPoint{
 validateSelectionFrame(frame);if(!RESIZE_HANDLES.includes(handle))throw new RangeError('Unknown resize handle');
 const [x,y]=direction[handle];return rotate(x,y,frame.rotation);
}
