/** Normalized, bounded and reversible crop manipulations; pixels remain engine-owned. */
export type CropRect=Readonly<{x:number;y:number;width:number;height:number}>;
export type CropCorner="nw"|"ne"|"sw"|"se";
const MIN=0.025;
export function validateCrop(rect:CropRect):void{
 if(![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||
   rect.x<0||rect.y<0||rect.width<MIN||rect.height<MIN||
   rect.x+rect.width>1+1e-9||rect.y+rect.height>1+1e-9)
  throw new RangeError("Invalid normalized crop rect");
}
export function moveCrop(rect:CropRect,dx:number,dy:number):CropRect{
 validateCrop(rect);
 if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new RangeError("Invalid crop move");
 return {...rect,x:Math.min(1-rect.width,Math.max(0,rect.x+dx)),
   y:Math.min(1-rect.height,Math.max(0,rect.y+dy))};
}
export function resizeCrop(rect:CropRect,corner:CropCorner,dx:number,dy:number):CropRect{
 validateCrop(rect);
 if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new RangeError("Invalid crop resize");
 let left=rect.x,right=rect.x+rect.width,top=rect.y,bottom=rect.y+rect.height;
 if(corner.includes("w"))left=Math.min(right-MIN,Math.max(0,left+dx));
 else right=Math.min(1,Math.max(left+MIN,right+dx));
 if(corner.includes("n"))top=Math.min(bottom-MIN,Math.max(0,top+dy));
 else bottom=Math.min(1,Math.max(top+MIN,bottom+dy));
 return {x:left,y:top,width:right-left,height:bottom-top};
}
export function cropToPixels(rect:CropRect,imageWidth:number,imageHeight:number){
 validateCrop(rect);
 if(!Number.isSafeInteger(imageWidth)||!Number.isSafeInteger(imageHeight)||imageWidth<1||imageHeight<1)
  throw new RangeError("Invalid image size");
 const left=Math.round(rect.x*imageWidth),top=Math.round(rect.y*imageHeight);
 const right=Math.round((rect.x+rect.width)*imageWidth),bottom=Math.round((rect.y+rect.height)*imageHeight);
 return {x:left,y:top,width:right-left,height:bottom-top};
}

/** Keep the opposite corner fixed while fitting a normalized aspect ratio. */
export function resizeCropWithAspect(rect:CropRect,corner:CropCorner,dx:number,dy:number,ratio?:number):CropRect{
 if(ratio===undefined)return resizeCrop(rect,corner,dx,dy);
 validateCrop(rect);
 if(![ratio,dx,dy].every(Number.isFinite)||ratio<=0)throw new RangeError('Invalid crop aspect');
 const west=corner.includes('w'),north=corner.includes('n');
 const x=west?rect.x+rect.width:rect.x,y=north?rect.y+rect.height:rect.y;
 const maxWidth=Math.min(west?x:1-x,(north?y:1-y)*ratio);
 const minWidth=Math.max(MIN,MIN*ratio);
 if(maxWidth<minWidth)return rect;
 const proposed=resizeCrop(rect,corner,dx,dy);
 const wanted=Math.abs(dx)>=Math.abs(dy*ratio)?proposed.width:proposed.height*ratio;
 const width=Math.min(maxWidth,Math.max(minWidth,wanted)),height=width/ratio;
 return {x:west?x-width:x,y:north?y-height:y,width,height};
}

/** Fit a ratio around the current crop centre without leaving the image. */
export function fitCropAspect(rect:CropRect,ratio:number):CropRect{
 validateCrop(rect);if(!Number.isFinite(ratio)||ratio<=0)throw new RangeError('Invalid crop aspect');
 const width=Math.min(1,ratio,Math.max(rect.width,rect.height*ratio)),height=width/ratio;
 if(width<MIN||height<MIN)throw new RangeError('Crop ratio is too narrow');
 return {x:Math.min(1-width,Math.max(0,rect.x+rect.width/2-width/2)),y:Math.min(1-height,Math.max(0,rect.y+rect.height/2-height/2)),width,height};
}
