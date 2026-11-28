/** When in a slide's life an effect plays. */
export type AnimationCategory="entrance"|"emphasis"|"exit";

/** An effect the animation pane can offer; `kind` is the engine's effect id. */
export interface AnimationEffect {
  readonly kind:string;
  readonly category:AnimationCategory;
  readonly label:string;
}

/**
 * Effects with their usual names. Hosts pass the subset their engine plays;
 * an effect the engine cannot store is never offered.
 */
export const SLIDE_ANIMATION_EFFECTS={
  fadeIn:{kind:"fadeIn",category:"entrance",label:"Fade in"},
  slideInLeft:{kind:"slideInLeft",category:"entrance",label:"Fly in from left"},
  zoomIn:{kind:"zoomIn",category:"entrance",label:"Zoom in"},
  pulse:{kind:"pulse",category:"emphasis",label:"Pulse"},
  spin:{kind:"spin",category:"emphasis",label:"Spin"},
  fadeOut:{kind:"fadeOut",category:"exit",label:"Fade out"},
  zoomOut:{kind:"zoomOut",category:"exit",label:"Zoom out"},
} as const satisfies Record<string,AnimationEffect>;

/** One animation on a slide; `index` is its position in the engine's list (what removal takes). */
export interface SlideAnimation {
  readonly index:number;
  readonly objectId:string;
  readonly kind:string;
  /** Seconds from the slide appearing. */
  readonly startS:number;
  readonly durationS:number;
  readonly trigger?:'on-click'|'with-previous'|'after-previous';
  readonly order?:number;
}

/** Longest start or duration the pane accepts, in seconds. */
export const ANIMATION_MAX_SECONDS=600;

/** Animations in play order: by start time, then by engine order. */
export function playOrder(animations:readonly SlideAnimation[]):SlideAnimation[]{
  return [...animations].sort((a,b)=>a.startS-b.startS||a.index-b.index);
}

/** When the last animation ends, in seconds; 0 with none. */
export function timelineEnd(animations:readonly SlideAnimation[]):number{
  return animations.reduce((m,a)=>Math.max(m,a.startS+a.durationS),0);
}

/**
 * Parses a seconds field ("1", "0.5", "1,5", "2 s"). Returns the value or an
 * error sentence naming the allowed range.
 */
export function parseSeconds(text:string,{allowZero}:{allowZero:boolean}):{value:number}|{error:string}{
  const t=text.trim().replace(/\s*s(ec(onds?)?)?$/iu,"").replace(",",".");
  const v=Number(t);
  if(t===""||!Number.isFinite(v))return {error:"Enter a number of seconds."};
  if(allowZero?v<0:v<=0)return {error:allowZero?"Use 0 seconds or more.":"Use more than 0 seconds."};
  if(v>ANIMATION_MAX_SECONDS)return {error:`Use ${ANIMATION_MAX_SECONDS} seconds or less.`};
  return {value:Math.round(v*1000)/1000};
}

/** "0.5 s", "2 s". */
export function formatSeconds(v:number):string{
  return String(Math.round(v*100)/100)+" s";
}

/** Effect name for `kind`, falling back to the raw kind for effects the catalog does not know. */
export function effectLabel(kind:string,effects:readonly AnimationEffect[]):string{
  return effects.find(e=>e.kind===kind)?.label??(SLIDE_ANIMATION_EFFECTS as Record<string,AnimationEffect>)[kind]?.label??kind;
}
