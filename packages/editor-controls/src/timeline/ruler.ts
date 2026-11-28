/*
 * Portions ported from FilmCraft for Android,
 * https://github.com/artcraft-android/filmcraft-android
 * apps/filmcraft-android/android/app/src/main/java/io/github/artcraftandroid/filmcraft/ui/editor/TimelineMath.kt
 * at commit c41b58467edd28d098336286528159b24c5203b5 (`rulerStep`, `rulerLabel`,
 * `clock`, `speedLabel`, the ruler's second and frame step tables, and the
 * zoom limits `minPxPerSecond` / `maxPxPerSecond` / `defaultPxPerSecond`).
 *
 * Copyright (c) 2026 ArtCraft Team and the FilmCraft contributors.
 * Licensed under the MIT License or the Apache License, Version 2.0, at your option.
 * See licenses/FilmCraft-LICENSE-MIT.txt, licenses/FilmCraft-LICENSE-APACHE.txt and
 * licenses/FilmCraft-NOTICE.txt.
 *
 * Modified for NYC-Tron UI on 2026-11-05: rewritten from Kotlin to TypeScript,
 * engine ticks replaced by whole frames at a rational frame rate, pixels per
 * second replaced by pixels per frame, and tick generation for a visible window
 * added (FilmCraft draws them inline in its Canvas). Frame steps are limited
 * to ones that divide the whole-number frame rate, so at 24 fps the labels run
 * 12f, 0:01, 12f rather than 20f, 16f, 12f.
 */
import {assertFrameRate,type FrameRate} from "../timebase.ts";
import {fps,framesToSeconds} from "./time.ts";

const SECOND_STEPS=[1,2,3,4,5,6,10,12,15,30,60,120,180,240,300,360,600,720,900,1800,3600] as const;
const FRAME_STEPS=[1,2,3,4,5,6,10,12,15,20,30] as const;

/** A ruler step from {@linkcode rulerStep}. */
export type RulerStep=
  |{readonly unit:"frames";readonly frames:number}
  |{readonly unit:"seconds";readonly seconds:number};

/**
 * The smallest step whose labels sit at least `minLabelPx` apart: whole frames
 * when zoomed in far enough, otherwise seconds, then minutes, up to an hour.
 */
export function rulerStep(pxPerFrame:number,minLabelPx:number,rate:FrameRate):RulerStep{
  assertFrameRate(rate);
  if(!(pxPerFrame>0)||!Number.isFinite(pxPerFrame))throw new RangeError("pxPerFrame must be positive");
  const f=fps(rate);
  const pxPerSecond=pxPerFrame*f;
  if(pxPerSecond>=minLabelPx){
    const whole=Math.round(f);
    for(const n of FRAME_STEPS){
      if(n>=f)break;
      if(whole%n!==0)continue;
      if(pxPerFrame*n>=minLabelPx)return {unit:"frames",frames:n};
    }
  }
  for(const s of SECOND_STEPS)if(pxPerSecond*s>=minLabelPx)return {unit:"seconds",seconds:s};
  return {unit:"seconds",seconds:3600};
}

/** `0:04`, `1:02:03`: the clock part of a time, seconds always two digits. */
export function clockLabel(seconds:number):string{
  const s=Math.max(0,Math.floor(seconds+1e-9));
  const h=Math.floor(s/3600),m=Math.floor(s/60)%60,sec=s%60;
  const two=(n:number)=>String(n).padStart(2,"0");
  return h>0?`${h}:${two(m)}:${two(sec)}`:`${m}:${two(sec)}`;
}

/** One ruler tick from {@linkcode rulerTicks}. */
export interface RulerTick {
  /** Timeline position in frames; fractional for whole seconds at NTSC rates. */
  readonly frame:number;
  /** Labeled (major) ticks carry text; minor ticks between them do not. */
  readonly label?:string;
}

/**
 * Ticks for the visible window `[startFrame, endFrame]`: a labeled tick every
 * step and four minor ticks between. Second steps sit on exact seconds, so at
 * 29.97 fps their frame positions are fractional. Frame-step labels read `15f`
 * between whole seconds and `0:02` on them. At most `maxTicks` are returned.
 */
export function rulerTicks(startFrame:number,endFrame:number,pxPerFrame:number,rate:FrameRate,minLabelPx=72,maxTicks=600):RulerTick[]{
  if(!(endFrame>=startFrame))throw new RangeError("endFrame must be at or after startFrame");
  const step=rulerStep(pxPerFrame,minLabelPx,rate);
  const fpsRound=Math.round(fps(rate));
  const stepFrames=step.unit==="frames"?step.frames:step.seconds*rate.numerator/rate.denominator;
  const minor=stepFrames/5;
  const first=Math.max(0,Math.floor(startFrame/minor));
  const ticks:RulerTick[]=[];
  for(let i=first;ticks.length<maxTicks;i++){
    const frame=i*minor;
    if(frame>endFrame)break;
    if(i%5!==0){ticks.push({frame});continue;}
    const k=i/5;
    if(step.unit==="frames"){
      const f=k*step.frames;
      ticks.push({frame:f,label:f%fpsRound===0?clockLabel(framesToSeconds(f,rate)):`${f%fpsRound}f`});
    }else ticks.push({frame,label:clockLabel(k*step.seconds)});
  }
  return ticks;
}

/** Zoom limits from {@linkcode zoomLimits}, in pixels per frame. */
export interface ZoomLimits {
  readonly min:number;
  readonly max:number;
}

/**
 * Narrowest zoom shows the whole timeline in half the viewport (never below 2
 * px per second); widest shows about six frames across the viewport.
 */
export function zoomLimits(viewportPx:number,durationFrames:number,rate:FrameRate):ZoomLimits{
  assertFrameRate(rate);
  if(!(viewportPx>0))throw new RangeError("Viewport width must be positive");
  const f=fps(rate);
  const secs=Math.max(1,durationFrames/f);
  const min=Math.max(2,viewportPx/2/secs)/f;
  const max=Math.max(min,viewportPx/6);
  return {min,max};
}

/** The default zoom: the first 15 seconds across the viewport (at least 4 px per second). */
export function defaultPxPerFrame(viewportPx:number,rate:FrameRate):number{
  return Math.max(4,viewportPx/15)/fps(rate);
}

/** `1x`, `0.25x`, `1.5x`: up to two decimals with trailing zeros dropped; reverse as `-1x`. */
export function speedLabel(speed:number):string{
  if(!Number.isFinite(speed))throw new RangeError("Speed must be finite");
  return speed.toFixed(2).replace(/\.?0+$/,"")+"x";
}
