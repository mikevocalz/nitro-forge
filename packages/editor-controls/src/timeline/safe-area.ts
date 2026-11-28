/** A rectangle in the overlay's layout coordinates. */
export interface OverlayRect {
  readonly x:number;
  readonly y:number;
  readonly width:number;
  readonly height:number;
}

/**
 * Safe-area percentages of the picture: SMPTE ST 2046-1 (action 93%, title 90%)
 * for HD and UHD, or the older 4:3-era convention (action 90%, title 80%).
 */
export const SAFE_AREA_PRESETS={
  smpte:{action:0.93,title:0.9},
  legacy:{action:0.9,title:0.8},
} as const satisfies Record<string,{action:number;title:number}>;
/** A safe-area preset name or explicit fractions of the picture. */
export type SafeAreaSpec=keyof typeof SAFE_AREA_PRESETS|{readonly action:number;readonly title:number};

/** Common framing guides (width over height). */
export const FRAME_GUIDES={
  scope:2.39,flat:1.85,square:1,vertical:9/16,portrait:4/5,
} as const satisfies Record<string,number>;

const assertRatio=(r:number,what:string)=>{
  if(!Number.isFinite(r)||r<=0||r>10)throw new RangeError(what+" must be a positive ratio up to 10");
};

/** The largest `aspect` (width/height) rectangle centered in `container`: the picture's letterbox or pillarbox fit. */
export function fitAspect(container:{readonly width:number;readonly height:number},aspect:number):OverlayRect{
  assertRatio(aspect,"Aspect");
  if(![container.width,container.height].every(Number.isFinite)||container.width<0||container.height<0)throw new RangeError("Invalid safe-area container");
  if(!(container.width>0)||!(container.height>0))return {x:0,y:0,width:0,height:0};
  const wide=container.width/container.height>aspect;
  const width=wide?container.height*aspect:container.width;
  const height=wide?container.height:container.width/aspect;
  return {x:(container.width-width)/2,y:(container.height-height)/2,width,height};
}

/** `rect` scaled by `fraction` about its center. */
export function insetRect(rect:OverlayRect,fraction:number):OverlayRect{
  if(!Number.isFinite(fraction)||fraction<=0||fraction>1)throw new RangeError("Safe-area fraction must be in (0, 1]");
  const width=rect.width*fraction,height=rect.height*fraction;
  return {x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
}

/** Picture, action-safe and title-safe rectangles for a picture of `aspect` inside `container`. */
export function safeAreas(container:{readonly width:number;readonly height:number},aspect:number,spec:SafeAreaSpec="smpte"){
  const s=typeof spec==="string"?SAFE_AREA_PRESETS[spec]:spec;
  if(!s||!(s.title<=s.action))throw new RangeError("Title safe must sit inside action safe");
  const picture=fitAspect(container,aspect);
  return {picture,action:insetRect(picture,s.action),title:insetRect(picture,s.title),fractions:s};
}

/** A framing guide of `guide` aspect inside `picture`, as it would be cropped (letterboxed or pillarboxed). */
export function guideRect(picture:OverlayRect,guide:number):OverlayRect{
  const r=fitAspect(picture,guide);
  return {...r,x:r.x+picture.x,y:r.y+picture.y};
}
