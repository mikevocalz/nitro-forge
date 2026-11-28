import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {createFrameScrubOwner} from "./frame-scrub-owner.ts";
import {useEffect,useLayoutEffect,useMemo,useRef} from "react";
import type {GestureResponderHandlers} from "react-native";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import type {LocalPoint} from "@nyc-tron/ui/components/gestures/local-pointer";
import {useLocalPointer} from "@nyc-tron/ui/components/gestures/useLocalPointer";
import {createValueGesture} from "@nyc-tron/ui/components/gestures/value-gesture";

/** Options for {@linkcode useFrameScrub}. */
export interface FrameScrubOptions {
  /** The committed frame. */
  readonly frame:number;
  /** Opt-in source/geometry ownership; must change for replacement coordinates. */
  readonly boundary?:string;
  /** Raw original-host preview restoration, captured at grant. */
  readonly onRestore?:()=>void;
  /** Maps a view-local point to a whole frame. */
  readonly frameAt:(point:LocalPoint)=>number;
  readonly onScrub?:(frame:number)=>void;
  /** Once per release that changed the frame. */
  readonly onCommit:(frame:number)=>void;
  readonly disabled?:boolean;
  /**
   * Grab mode for handles: pressing does not move the frame, and a drag moves it
   * by the pointer's travel at this zoom. Without it the press jumps to
   * `frameAt` (a ruler or a seek track).
   */
  readonly grabPxPerFrame?:number;
  /** Clamp for grab mode. */
  readonly durationFrames?:number;
}
/** Returned by {@linkcode useFrameScrub}. */
export interface FrameScrub {
  readonly handlers:GestureResponderHandlers;
  /** The frame to draw: the scrub preview during a drag, else the committed frame. */
  readonly shown:number;
  readonly active:boolean;
  /** Restores the start frame (Escape). */
  cancel():void;
}

/**
 * Press-and-drag frame scrubbing for the seek bar, ruler, playhead and in/out
 * handles: the press jumps, moves preview through `onScrub`, release commits
 * once, and cancel restores the start frame through `onScrub`.
 */
export function useFrameScrub({frame,frameAt,onScrub,onCommit,disabled=false,grabPxPerFrame,durationFrames,boundary,onRestore}:FrameScrubOptions):FrameScrub{
  const [preview,store]=useLocalStore(()=>undefined as number|undefined);
  const latest=useRef({frame,frameAt,onScrub,onCommit,disabled,grabPxPerFrame,durationFrames,onRestore});
  useLayoutEffect(()=>{latest.current={frame,frameAt,onScrub,onCommit,disabled,grabPxPerFrame,durationFrames,onRestore};});
  const ownership=useEditorBoundary([boundary,disabled]);
  const captured=useRef<typeof latest.current|null>(null);
  const owner=useMemo(()=>createFrameScrubOwner(value=>store.set(value)),[store]);
  useLayoutEffect(()=>{if(boundary!==undefined)owner.admit(ownership,disabled);else owner.invalidate();},[owner,boundary,ownership,disabled]);
  useLayoutEffect(()=>()=>owner.invalidate(),[owner]);
  const grab=useRef({x0:0,frame0:0});
  const target=(p:LocalPoint)=>{
    const l=boundary===undefined?latest.current:captured.current??latest.current;
    if(l.grabPxPerFrame===undefined)return l.frameAt(p);
    const f=Math.round(grab.current.frame0+(p.x-grab.current.x0)/l.grabPxPerFrame);
    return Math.max(0,Math.min(l.durationFrames??Number.MAX_SAFE_INTEGER,f));
  };
  const gesture=useMemo(()=>createValueGesture<number>({
    disabled:()=>latest.current.disabled,
    equals:(a,b)=>a===b,
    preview:f=>{store.set(f);latest.current.onScrub?.(f);},
    commit:f=>latest.current.onCommit(f),
  }),[store]);
  useEffect(()=>()=>gesture.cancel(),[gesture]);
  const end=()=>store.set(undefined);
  const handlers=useLocalPointer({
    disabled,
    onBegin:p=>{
      if(boundary!==undefined){
        if(!owner.admitted(ownership))return;
        const l=latest.current;captured.current=l;grab.current={x0:p.x,frame0:l.frame};
        const began=owner.begin(ownership,l.frame,{disabled:l.disabled,preview:l.onScrub,restore:l.onRestore??(()=>l.onScrub?.(l.frame)),commit:l.onCommit});
        if(!began)return;
        if(l.grabPxPerFrame===undefined&&owner.current(ownership))owner.move(ownership,target(p));
        return;
      }
      grab.current={x0:p.x,frame0:latest.current.frame};
      gesture.begin(latest.current.frame);
      if(latest.current.grabPxPerFrame===undefined)gesture.update(target(p));
    },
    onMove:p=>{if(boundary!==undefined){if(owner.current(ownership))owner.move(ownership,target(p));}else gesture.update(target(p));},
    onRelease:()=>{if(boundary!==undefined)owner.release(ownership);else{gesture.release();end();}},
    onCancel:()=>{if(boundary!==undefined)owner.cancel(ownership);else{gesture.cancel();end();}},
  });
  return {handlers,shown:preview??frame,active:preview!==undefined,cancel:()=>{if(boundary!==undefined)owner.cancel(ownership);else{gesture.cancel();end();}}};
}
