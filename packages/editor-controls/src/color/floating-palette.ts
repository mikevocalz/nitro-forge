/*
 * Portions ported from ProCraft for Android,
 * https://github.com/artcraft-android/procraft-android
 * android/app/src/main/java/io/github/artcraftandroid/procraft/ui/ColorPanel.kt
 * at commit c2f7518d03141c746a365f90d8df05a44ddef002 (`UndockHandle` and
 * `FloatingColors`: the 30 dp undock distance, the 260 dp floating width, the
 * grab point at the window's top middle, keeping the window on screen, and the
 * disc/classic/palettes mode set).
 *
 * Copyright (c) 2026 ArtCraft Team and the ProCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/ProCraft-LICENSE-MIT.txt, licenses/ProCraft-LICENSE-APACHE.txt and
 * licenses/ProCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Kotlin/Compose to
 * TypeScript as pure functions, the view-model state moved to the host, the
 * modes renamed compact/classic/palettes, and fold/hinge avoidance added for
 * foldable and dual-screen layouts.
 */

/** Drag distance, in layout units, after which a docked palette floats. ProCraft uses 30 dp. */
export const UNDOCK_DISTANCE=30;
/** Floating palette width. ProCraft's floating window is 260 dp wide. */
export const FLOATING_PALETTE_WIDTH=260;

/** The views a `FloatingColorPalette` switches between. The host renders each one. */
export type PaletteMode="compact"|"classic"|"palettes";
/** Every {@linkcode PaletteMode} with its tab label, in tab order. */
export const PALETTE_MODES=[
  {mode:"compact",label:"Compact"},
  {mode:"classic",label:"Classic"},
  {mode:"palettes",label:"Palettes"},
] as const satisfies readonly {mode:PaletteMode;label:string}[];

/** A rectangle in the host's layout coordinates. */
export interface PaletteRect {
  readonly x:number;
  readonly y:number;
  readonly width:number;
  readonly height:number;
}
/** Top-left corner of a floating palette in the host's layout coordinates. */
export interface PalettePosition {
  readonly x:number;
  readonly y:number;
}

/** Whether a handle drag has travelled far enough to undock: {@linkcode UNDOCK_DISTANCE}. */
export function shouldUndock(dx:number,dy:number):boolean{
  return Math.hypot(dx,dy)>UNDOCK_DISTANCE;
}

/**
 * Where the window goes when a handle held at `grab` (offset inside the window)
 * is at `pointer`: the pointer keeps holding the same spot of the window.
 */
export function positionFromGrab(pointer:PalettePosition,grab:PalettePosition):PalettePosition{
  return {x:pointer.x-grab.x,y:pointer.y-grab.y};
}

const intersects=(a:PaletteRect,b:PaletteRect)=>
  a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const clampAxis=(value:number,size:number,start:number,length:number)=>
  Math.min(Math.max(value,start),Math.max(start,start+length-size));

/** Result of {@linkcode placeFloatingPalette}. */
export interface PalettePlacement {
  readonly position:PalettePosition;
  /** True when no in-bounds spot clears every obstacle; the window then overlaps one. */
  readonly overlapsObstacle:boolean;
}

/**
 * Keeps a floating palette of `size` inside `bounds` and off every obstacle
 * (a hinge, a fold, a separating display gap or a camera cutout). When the
 * clamped rectangle crosses an obstacle it moves to the in-bounds side of that
 * obstacle that needs the least travel. Restoring a saved position after a
 * posture change goes through the same function, so a palette saved on one
 * screen of a dual-screen device is never restored across the hinge.
 */
export function placeFloatingPalette(
  desired:PalettePosition,size:{readonly width:number;readonly height:number},
  bounds:PaletteRect,obstacles:readonly PaletteRect[]=[],
):PalettePlacement{
  if(![desired.x,desired.y,size.width,size.height,bounds.x,bounds.y,bounds.width,bounds.height,bounds.x+bounds.width,bounds.y+bounds.height].every(Number.isFinite)||size.width<=0||size.height<=0||bounds.width<=0||bounds.height<=0||obstacles.length>64||obstacles.some(o=>![o.x,o.y,o.width,o.height,o.x+o.width,o.y+o.height].every(Number.isFinite)||o.width<0||o.height<0))
    throw new RangeError("Palette placement needs bounded finite geometry");
  const clamp=(p:PalettePosition):PalettePosition=>({x:clampAxis(p.x,size.width,bounds.x,bounds.width),y:clampAxis(p.y,size.height,bounds.y,bounds.height)});
  const fits=(p:PalettePosition)=>p.x>=bounds.x&&p.y>=bounds.y&&p.x+size.width<=bounds.x+bounds.width&&p.y+size.height<=bounds.y+bounds.height&&obstacles.every(o=>!intersects({...p,...size},o));
  const start=clamp(desired);
  if(fits(start))return {position:start,overlapsObstacle:false};
  // Every free axis-aligned placement can be slid to a bounds/obstacle edge.
  // Search edge intersections too: moving around one fold may hit another.
  const xs=new Set([start.x,bounds.x,bounds.x+bounds.width-size.width]),ys=new Set([start.y,bounds.y,bounds.y+bounds.height-size.height]);
  for(const o of obstacles){xs.add(o.x-size.width);xs.add(o.x+o.width);ys.add(o.y-size.height);ys.add(o.y+o.height);}
  let best:PalettePosition|undefined,distance=Infinity;
  for(const x of xs)for(const y of ys){const at=clamp({x,y}),travel=Math.hypot(at.x-start.x,at.y-start.y);if(travel<distance&&fits(at)){best=at;distance=travel;}}
  return best?{position:best,overlapsObstacle:false}:{position:start,overlapsObstacle:true};
}

/** Arrow-key nudge for a floating palette: 8 units, or 32 with a page key. */
export function nudgePalette(position:PalettePosition,key:string|undefined):PalettePosition|undefined{
  switch(key){
    case "ArrowLeft":return {x:position.x-8,y:position.y};
    case "ArrowRight":return {x:position.x+8,y:position.y};
    case "ArrowUp":return {x:position.x,y:position.y-8};
    case "ArrowDown":return {x:position.x,y:position.y+8};
    case "PageUp":return {x:position.x,y:position.y-32};
    case "PageDown":return {x:position.x,y:position.y+32};
    default:return undefined;
  }
}
