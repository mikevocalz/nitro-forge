import type {SlideObject,SlideSize} from "./slide-model.ts";

/** A box in slide units. */
export interface SlideRect {
  readonly x:number;
  readonly y:number;
  readonly w:number;
  readonly h:number;
}

/** A guide line the canvas draws while an object snaps: vertical at x, or horizontal at y. */
export interface SnapGuide {
  readonly axis:"x"|"y";
  readonly at:number;
}

/** Smallest object edge, in slide units. */
export const SLIDE_MIN_OBJECT=8;
/** Snap distance in screen points; divide by the canvas scale to get slide units. */
export const SLIDE_SNAP_POINTS=6;

/** Scale that fits `size` into `width` × `height` points. */
export function fitScale(size:SlideSize,width:number,height=Infinity):number{
  if(!(size.width>0)||!(size.height>0)||!(width>0))return 0;
  return Math.min(width/size.width,height>0?height/size.height:Infinity);
}

/**
 * Snaps a moving box's left/center/right and top/middle/bottom to the slide's
 * edges and center and to the other objects' edges and centers, when within
 * `threshold` slide units. Returns the snapped position and the guides hit.
 */
export function snapRect(rect:SlideRect,others:readonly SlideRect[],size:SlideSize,threshold:number):{x:number;y:number;guides:SnapGuide[]}{
  const xs=[0,size.width/2,size.width,...others.flatMap(o=>[o.x,o.x+o.w/2,o.x+o.w])];
  const ys=[0,size.height/2,size.height,...others.flatMap(o=>[o.y,o.y+o.h/2,o.y+o.h])];
  const axis=(start:number,len:number,lines:readonly number[])=>{
    let best:{delta:number;at:number}|undefined;
    for(const edge of [start,start+len/2,start+len])for(const line of lines){
      const delta=line-edge;
      if(Math.abs(delta)<=threshold&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,at:line};
    }
    return best;
  };
  const bx=axis(rect.x,rect.w,xs),by=axis(rect.y,rect.h,ys);
  const guides:SnapGuide[]=[];
  if(bx)guides.push({axis:"x",at:bx.at});
  if(by)guides.push({axis:"y",at:by.at});
  return {x:rect.x+(bx?.delta??0),y:rect.y+(by?.delta??0),guides};
}

/**
 * New size after dragging the bottom-end corner by `dx`, `dy` slide units.
 * `keepRatio` (Shift) keeps the aspect ratio, following the larger change.
 */
export function resizeFromCorner(rect:SlideRect,dx:number,dy:number,keepRatio=false):{w:number;h:number}{
  let w=Math.max(SLIDE_MIN_OBJECT,rect.w+dx);
  let h=Math.max(SLIDE_MIN_OBJECT,rect.h+dy);
  if(keepRatio&&rect.w>0&&rect.h>0){
    const ratio=rect.w/rect.h;
    if(Math.abs(dx)>=Math.abs(dy))h=Math.max(SLIDE_MIN_OBJECT,w/ratio);else w=Math.max(SLIDE_MIN_OBJECT,h*ratio);
  }
  return {w:round2(w),h:round2(h)};
}

/** Arrow-key nudge: 1 unit, 10 with Shift. `undefined` for any other key. */
export function nudge(key:string,shift:boolean,rtl=false):{dx:number;dy:number}|undefined{
  const step=shift?10:1;
  const right=rtl?-step:step;
  switch(key){
    case "ArrowLeft":return {dx:-right,dy:0};
    case "ArrowRight":return {dx:right,dy:0};
    case "ArrowUp":return {dx:0,dy:-step};
    case "ArrowDown":return {dx:0,dy:step};
    default:return undefined;
  }
}

/** Rotation after a 15° step (`[` or `]`), normalised to -180..180. */
export function stepRotation(degrees:number,direction:1|-1,step=15):number{
  let r=(Math.round(degrees/step)+direction)*step;
  r=((r+180)%360+360)%360-180;
  return r===-180?180:r;
}

/** Topmost object at a slide point, ignoring rotation; `undefined` for empty slide. */
export function hitTest(objects:readonly SlideObject[],x:number,y:number):SlideObject|undefined{
  for(let i=objects.length-1;i>=0;i--){
    const o=objects[i]!;
    if(x>=o.x&&x<=o.x+o.w&&y>=o.y&&y<=o.y+o.h)return o;
  }
  return undefined;
}

/** Screen-reader description of an object's place and size. */
export function objectLabel(o:SlideObject):string{
  const what=o.kind==="text"?"Text box"+(o.text?.trim()?", "+o.text.trim().slice(0,60):", empty"):o.kind==="rect"?"Rectangle":"Image";
  return what+", at "+Math.round(o.x)+", "+Math.round(o.y)+", "+Math.round(o.w)+" by "+Math.round(o.h)+(o.rotation?", rotated "+Math.round(o.rotation)+" degrees":"");
}

function round2(v:number){return Math.round(v*100)/100;}
