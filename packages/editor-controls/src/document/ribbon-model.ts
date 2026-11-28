/** Character toggles on the ribbon's font group. */
export type InlineToggle="bold"|"italic"|"underline"|"strike";

/** Every {@linkcode InlineToggle} in display order. */
export const INLINE_TOGGLES:readonly InlineToggle[]=["bold","italic","underline","strike"];

/** A toggle's state over the selection: on everywhere, off everywhere, or mixed. */
export type ToggleState=boolean|"mixed";

/** A value shared by the whole selection, `"mixed"` when it differs, `undefined` when unset everywhere. */
export type SharedValue<T>=T|"mixed"|undefined;

/** Character style of one run, as a rich-text engine reports it. */
export interface RunStyle {
  readonly bold?:boolean;
  readonly italic?:boolean;
  readonly underline?:boolean;
  readonly strike?:boolean;
  readonly color?:string;
}

/** What the ribbon shows for a selection. Built by {@linkcode ribbonStateFor}. */
export interface RibbonState {
  readonly bold:ToggleState;
  readonly italic:ToggleState;
  readonly underline:ToggleState;
  readonly strike:ToggleState;
  readonly color:SharedValue<string>;
}

/** Ribbon state for the runs a selection covers. No runs (an empty caret) reads as all off. */
export function ribbonStateFor(runs:readonly RunStyle[]):RibbonState{
  const tri=(k:InlineToggle):ToggleState=>{
    if(runs.length===0)return false;
    const on=runs.filter(r=>r[k]===true).length;
    return on===0?false:on===runs.length?true:"mixed";
  };
  return {bold:tri("bold"),italic:tri("italic"),underline:tri("underline"),strike:tri("strike"),color:sharedValue(runs.map(r=>r.color))};
}

/** The common value of `values`, `"mixed"` when they differ. */
export function sharedValue<T>(values:readonly (T|undefined)[]):SharedValue<T>{
  if(values.length===0)return undefined;
  const first=values[0];
  return values.every(v=>v===first)?first:"mixed";
}

/** A toggle press turns a mixed or off selection on, and an on selection off (as document editors do). */
export function nextToggle(state:ToggleState):boolean{
  return state!==true;
}

/** Text case changes offered by the case control. */
export type TextCase="sentence"|"lower"|"upper"|"capitalize";

/** Labels for {@linkcode TextCase}, each written in its own case. */
export const TEXT_CASE_LABELS:Record<TextCase,string>={sentence:"Sentence case",lower:"lowercase",upper:"UPPERCASE",capitalize:"Capitalize Each Word"};

/** Applies a {@linkcode TextCase} to plain text. */
export function applyTextCase(text:string,mode:TextCase):string{
  if(mode==="lower")return text.toLocaleLowerCase();
  if(mode==="upper")return text.toLocaleUpperCase();
  if(mode==="capitalize")return text.toLocaleLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu,(_m,a:string,b:string)=>a+b.toLocaleUpperCase());
  return text.toLocaleLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu,(_m,a:string,b:string)=>a+b.toLocaleUpperCase());
}

/** Smallest and largest font size the size stepper allows, in points. */
export const FONT_SIZE_MIN=1;
export const FONT_SIZE_MAX=1638;
/** The standard size ladder the stepper walks. */
export const FONT_SIZE_STEPS=[8,9,10,10.5,11,12,14,16,18,20,24,28,32,36,40,44,48,54,60,66,72,80,88,96] as const;

/** Next size up or down the ladder from `size`, clamped to the allowed range. */
export function stepFontSize(size:number,direction:1|-1):number{
  if(!Number.isFinite(size))return 12;
  if(direction>0)return FONT_SIZE_STEPS.find(s=>s>size)??Math.min(FONT_SIZE_MAX,Math.floor(size/10)*10+10);
  return [...FONT_SIZE_STEPS].reverse().find(s=>s<size)??Math.max(FONT_SIZE_MIN,size-1);
}

/** What a keyboard shortcut on the editor asks the ribbon to do. */
export type RibbonShortcut={toggle:InlineToggle};

/**
 * Maps Mod+B / Mod+I / Mod+U / Mod+Shift+X to a toggle. The editor calls this
 * from its own key handler, where the caret lives.
 */
export function ribbonShortcut(key:string,mod:boolean,shift:boolean):RibbonShortcut|undefined{
  if(!mod)return undefined;
  const k=key.toLowerCase();
  if(!shift&&k==="b")return {toggle:"bold"};
  if(!shift&&k==="i")return {toggle:"italic"};
  if(!shift&&k==="u")return {toggle:"underline"};
  if(shift&&k==="x")return {toggle:"strike"};
  return undefined;
}
