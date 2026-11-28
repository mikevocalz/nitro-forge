import {screenPointToDoc,validateViewport,validateDocRect,type CanvasViewport,type DocPoint,type DocRect} from './canvas-viewport.ts';
export interface CanvasZoomLimits {readonly minZoom:number;readonly maxZoom:number}
export const DEFAULT_CANVAS_ZOOM_LIMITS:CanvasZoomLimits={minZoom:0.01,maxZoom:128};
export function validateZoomLimits(limits:CanvasZoomLimits):void {
 if(![limits.minZoom,limits.maxZoom].every(Number.isFinite)||limits.minZoom<=0||limits.maxZoom<limits.minZoom)throw new RangeError('Invalid canvas zoom limits');
}
const point=(p:DocPoint)=>{if(![p.x,p.y].every(Number.isFinite))throw new RangeError('Invalid canvas point');};
const checked=(viewport:CanvasViewport)=>{validateViewport(viewport);return viewport;};
/** Change zoom around a screen point, preserving the document coordinate beneath it. */
export function zoomCanvasAt(viewport:CanvasViewport,zoom:number,anchor:DocPoint,limits:CanvasZoomLimits=DEFAULT_CANVAS_ZOOM_LIMITS):CanvasViewport {
 validateViewport(viewport);validateZoomLimits(limits);point(anchor);if(!Number.isFinite(zoom)||zoom<=0)throw new RangeError('Invalid requested zoom');
 const z=Math.max(limits.minZoom,Math.min(limits.maxZoom,zoom)),doc=screenPointToDoc(viewport,anchor);
 return checked({...viewport,zoom:z,panX:anchor.x-doc.x*z,panY:anchor.y-doc.y*z});
}
/** Translate content by screen units; canvas geometry never mirrors in RTL. */
export function panCanvasBy(viewport:CanvasViewport,dx:number,dy:number):CanvasViewport {
 validateViewport(viewport);if(![dx,dy].every(Number.isFinite))throw new RangeError('Invalid canvas translation');
 return checked({...viewport,panX:viewport.panX+dx,panY:viewport.panY+dy});
}
const center=(points:readonly DocPoint[]):DocPoint=>({x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length});
/** One- or two-pointer mapping from a captured grant; combines pinch and centroid translation. */
export function canvasFromTouches(viewport:CanvasViewport,before:readonly DocPoint[],after:readonly DocPoint[],limits:CanvasZoomLimits=DEFAULT_CANVAS_ZOOM_LIMITS):CanvasViewport {
 validateViewport(viewport);validateZoomLimits(limits);
 if((before.length!==1&&before.length!==2)||after.length!==before.length)throw new RangeError('Canvas gestures require the same one or two pointers');
 before.forEach(point);after.forEach(point);
 const from=center(before),to=center(after);
 let zoom=viewport.zoom;
 if(before.length===2){const distance=Math.hypot(before[1]!.x-before[0]!.x,before[1]!.y-before[0]!.y);if(distance>=1)zoom*=Math.hypot(after[1]!.x-after[0]!.x,after[1]!.y-after[0]!.y)/distance;}
 // A coincident pair can shrink to zero: stop at the minimum rather than divide or reject.
 const z=Math.max(limits.minZoom,Math.min(limits.maxZoom,zoom)),doc=screenPointToDoc(viewport,from);
 return checked({...viewport,zoom:z,panX:to.x-doc.x*z,panY:to.y-doc.y*z});
}
/** Fit a positive-area document rectangle inside the measured viewport and padding. */
export function fitCanvas(viewport:CanvasViewport,bounds:DocRect,padding=16,limits:CanvasZoomLimits=DEFAULT_CANVAS_ZOOM_LIMITS):CanvasViewport {
 validateViewport(viewport);validateDocRect(bounds);validateZoomLimits(limits);
 if(!Number.isFinite(padding)||padding<0||bounds.w<=0||bounds.h<=0||viewport.width<=2*padding||viewport.height<=2*padding)throw new RangeError('Canvas fit needs positive usable area');
 const zoom=Math.max(limits.minZoom,Math.min(limits.maxZoom,(viewport.width-2*padding)/bounds.w,(viewport.height-2*padding)/bounds.h));
 return checked({...viewport,zoom,panX:viewport.width/2-(bounds.x+bounds.w/2)*zoom,panY:viewport.height/2-(bounds.y+bounds.h/2)*zoom});
}
export interface CanvasWheelDelta {readonly deltaX:number;readonly deltaY:number;readonly deltaMode:0|1|2;readonly zoom:boolean;readonly anchor:DocPoint}
/** Pixel/line/page wheel deltas. Pinch-wheel keeps its anchor; ordinary wheel pans. */
export function canvasFromWheel(viewport:CanvasViewport,input:CanvasWheelDelta,limits:CanvasZoomLimits=DEFAULT_CANVAS_ZOOM_LIMITS):CanvasViewport {
 validateViewport(viewport);point(input.anchor);
 if(![input.deltaX,input.deltaY].every(Number.isFinite)||![0,1,2].includes(input.deltaMode))throw new RangeError('Invalid canvas wheel delta');
 const dx=input.deltaX*(input.deltaMode===1?16:input.deltaMode===2?viewport.width:1),dy=input.deltaY*(input.deltaMode===1?16:input.deltaMode===2?viewport.height:1);
 if(input.zoom){const exponent=Math.max(-20,Math.min(20,-dy*0.002));return zoomCanvasAt(viewport,viewport.zoom*Math.exp(exponent),input.anchor,limits);}
 return panCanvasBy(viewport,-dx,-dy);
}
export function sameCanvasView(a:CanvasViewport,b:CanvasViewport):boolean {return a.zoom===b.zoom&&a.panX===b.panX&&a.panY===b.panY&&a.width===b.width&&a.height===b.height;}
