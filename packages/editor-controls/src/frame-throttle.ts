/** Scheduler pair for {@linkcode createFrameThrottle}; defaults to `requestAnimationFrame`. */
export interface FrameScheduler {
  request(callback:()=>void):unknown;
  cancel(handle:unknown):void;
}

/** Handle returned by {@linkcode createFrameThrottle}. */
export interface FrameThrottle<T> {
  /** Queues `value`. Only the newest queued value is delivered, once, on the next frame. */
  push(value:T):void;
  /** Delivers the queued value now, if any, and drops the pending frame. */
  flush():void;
  /** Drops the queued value without delivering it. */
  cancel():void;
  /** Whether a value is waiting for the next frame. */
  readonly pending:boolean;
}

const fallback:FrameScheduler={
  request:callback=>setTimeout(callback,16),
  cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `requestAnimationFrame` where the runtime has it (browsers, React Native), else a 16 ms timer. */
export function animationFrameScheduler():FrameScheduler{
  const g=globalThis as {requestAnimationFrame?:(cb:()=>void)=>number;cancelAnimationFrame?:(id:number)=>void};
  if(typeof g.requestAnimationFrame!=="function"||typeof g.cancelAnimationFrame!=="function")return fallback;
  return {request:cb=>g.requestAnimationFrame!(cb),cancel:id=>g.cancelAnimationFrame!(id as number)};
}

/**
 * Coalesces rapid values (drag moves, typed edits) into at most one `deliver`
 * call per animation frame. Nothing is scheduled until the first `push`, so a
 * caller with no consumer never starts a frame loop.
 */
export function createFrameThrottle<T>(deliver:(value:T)=>void,scheduler:FrameScheduler=animationFrameScheduler()):FrameThrottle<T>{
  let queued:{value:T}|undefined;
  let handle:unknown;
  let scheduled=false;
  const run=()=>{
    scheduled=false;
    const next=queued;
    queued=undefined;
    if(next)deliver(next.value);
  };
  return {
    push(value){
      queued={value};
      if(scheduled)return;
      scheduled=true;
      handle=scheduler.request(run);
    },
    flush(){
      if(scheduled){scheduler.cancel(handle);scheduled=false;}
      const next=queued;
      queued=undefined;
      if(next)deliver(next.value);
    },
    cancel(){
      if(scheduled){scheduler.cancel(handle);scheduled=false;}
      queued=undefined;
    },
    get pending(){return queued!==undefined;},
  };
}
