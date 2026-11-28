/**
 * Engine-neutral ink toolbar contract. The host board (Nitro Forge's
 * QuickDraw store, its ink lab session, or any other stroke engine) owns the
 * tool, size, color, opacity, history and pressure state. {@linkcode InkToolbar}
 * only renders that state and reports intent through callbacks.
 *
 * The defaults mirror the Forge board as of 2026-11-05: QuickDraw sizes
 * `s`/`m`/`l`/`xl`, and the ink lab's `pen`/`highlighter`/`eraser` tools.
 * `marker` and `lasso` are part of the union for hosts that implement them;
 * the board does not yet, so they are not in {@linkcode INK_BOARD_TOOLS}.
 */
import type {KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";

/**
 * A drawing tool shown in an {@linkcode InkToolbar}.
 * @see {@linkcode InkToolOption.tool}
 */
export type InkTool="pen"|"marker"|"highlighter"|"eraser"|"lasso";

/**
 * A stroke size step. Matches the QuickDraw `props.size` values the Forge
 * board compiles; {@linkcode INK_SIZE_POINTS} gives the stroke width of each.
 */
export type InkSize="s"|"m"|"l"|"xl";

/** Size steps from thinnest to thickest. Used for increment and decrement. */
export const INK_SIZES=["s","m","l","xl"] as const satisfies readonly InkSize[];

/**
 * Stroke width in board points for each {@linkcode InkSize}, copied from the
 * Forge board's QuickDraw scene compiler. The toolbar uses it only to draw the
 * size preview dot; the board keeps its own copy for rendering.
 */
export const INK_SIZE_POINTS={s:2.5,m:4,l:6.5,xl:10} as const satisfies Record<InkSize,number>;

/** Spoken and visible names for each {@linkcode InkSize}. */
export const INK_SIZE_LABELS={s:"Small",m:"Medium",l:"Large",xl:"Extra large"} as const satisfies Record<InkSize,string>;

/** Visible names for each {@linkcode InkTool}. */
export const INK_TOOL_LABELS={
 pen:"Pen",marker:"Marker",highlighter:"Highlighter",eraser:"Eraser",lasso:"Lasso",
} as const satisfies Record<InkTool,string>;

/** The tools the Forge board implements today, in toolbar order. */
export const INK_BOARD_TOOLS=["pen","highlighter","eraser"] as const satisfies readonly InkTool[];

/** Minimum edge of every interactive part of the toolbar, in points. */
export const INK_TOUCH_TARGET=44;

/** Opacity change applied by one increment or decrement. */
export const INK_OPACITY_STEP=0.1;

/**
 * Whether a toolbar control can act. A disabled control stays focusable and
 * says why it is unavailable, both to screen readers and in the toolbar's
 * notice line when it is pressed.
 * @see {@linkcode InkToolbarProps.undo}
 */
export type InkAvailability=Readonly<{enabled:true}>|Readonly<{enabled:false;reason:string}>;

/** Convenience value for an available control. */
export const INK_ENABLED:InkAvailability=Object.freeze({enabled:true});

/**
 * One tool button in an {@linkcode InkToolbar}.
 * @see {@linkcode InkToolbarProps.tools}
 */
export type InkToolOption=Readonly<{
 tool:InkTool;
 /** Visible label. @default the {@linkcode INK_TOOL_LABELS} entry */
 label?:string;
 /** Set when the host has this tool but it cannot be used right now. */
 disabledReason?:string;
}>;

/**
 * One color swatch. The host supplies every color; the toolbar ships none.
 * @see {@linkcode InkToolbarProps.swatches}
 */
export type InkSwatch=Readonly<{
 /** Stable id the host stores, such as the QuickDraw color name `"blue"`. */
 id:string;
 /** Spoken name, such as "Blue". */
 label:string;
 /** Any React Native color string used to paint the swatch. */
 value:string;
}>;

/**
 * Pressure toggle state. Pass it only when the host has measured pressure
 * from the current hardware (a stylus or a verified pen protocol); the toggle
 * is not rendered otherwise, because offering pressure the device cannot
 * report would be a dead control.
 * @see {@linkcode InkToolbarProps.pressure}
 */
export type InkPressure=Readonly<{
 /** Whether strokes use measured pressure for width. */
 enabled:boolean;
 /** Set when pressure is supported but cannot change now, such as during a stroke. */
 disabledReason?:string;
}>;

/**
 * A command the toolbar or a keyboard shortcut asks the host to perform.
 * @see {@linkcode resolveInkShortcut}
 */
export type InkCommand=
 |Readonly<{type:"select-tool";tool:InkTool}>
 |Readonly<{type:"size";direction:-1|1}>
 |Readonly<{type:"undo"}>
 |Readonly<{type:"redo"}>;

const TOOL_KEYS={p:"pen",m:"marker",h:"highlighter",e:"eraser",l:"lasso"} as const satisfies Record<string,InkTool>;

/** Shortcut letter shown in hints for each tool. */
export const INK_TOOL_SHORTCUTS={
 pen:"P",marker:"M",highlighter:"H",eraser:"E",lasso:"L",
} as const satisfies Record<InkTool,string>;

/** Keyboard event fields {@linkcode resolveInkShortcut} reads. */
export interface InkKeyEvent extends KeyEventLike {
 readonly metaKey?:boolean;
 readonly ctrlKey?:boolean;
 readonly shiftKey?:boolean;
 readonly altKey?:boolean;
}

/**
 * Map a key press to an {@linkcode InkCommand}, or `undefined` when the key
 * is not an ink shortcut. The toolbar never installs a global listener; the
 * host calls this from its own key handling (and the toolbar calls it for keys
 * pressed while focus is inside it).
 *
 * P, M, H, E and L pick tools; `[` and `]` step the size; Cmd/Ctrl+Z undoes;
 * Cmd/Ctrl+Shift+Z and Ctrl+Y redo. Tool letters with a modifier held are
 * ignored so they never shadow app menu shortcuts.
 */
export function resolveInkShortcut(event:InkKeyEvent):InkCommand|undefined{
 const raw=event.key??event.nativeEvent?.key;
 if(typeof raw!=="string")return undefined;
 const key=raw.length===1?raw.toLowerCase():raw;
 const command=event.metaKey===true||event.ctrlKey===true;
 if(command&&event.altKey!==true){
  if(key==="z")return event.shiftKey===true?{type:"redo"}:{type:"undo"};
  if(key==="y"&&event.ctrlKey===true&&event.metaKey!==true)return {type:"redo"};
  return undefined;
 }
 if(command||event.altKey===true)return undefined;
 if(key==="[")return {type:"size",direction:-1};
 if(key==="]")return {type:"size",direction:1};
 if(Object.hasOwn(TOOL_KEYS,key))return {type:"select-tool",tool:TOOL_KEYS[key as keyof typeof TOOL_KEYS]};
 return undefined;
}

/** The size one step thinner (-1) or thicker (+1), clamped at the ends. */
export function stepInkSize(size:InkSize,direction:-1|1):InkSize{
 const index=INK_SIZES.indexOf(size);
 if(index<0)throw new RangeError("Unknown ink size: "+String(size));
 return INK_SIZES[Math.max(0,Math.min(INK_SIZES.length-1,index+direction))]!;
}

/** Clamp to 0..1 and round to whole percent. */
export function normalizeInkOpacity(value:number):number{
 if(!Number.isFinite(value))throw new RangeError("Opacity must be a finite number");
 return Math.round(Math.min(1,Math.max(0,value))*100)/100;
}

/** Opacity after one increment (+1) or decrement (-1). Never steps below 10%. */
export function stepInkOpacity(value:number,direction:-1|1,step=INK_OPACITY_STEP):number{
 return Math.max(INK_OPACITY_STEP,normalizeInkOpacity(value+direction*step));
}

/** "40%" style label for an opacity in 0..1. */
export function formatInkOpacity(value:number):string{
 return Math.round(normalizeInkOpacity(value)*100)+"%";
}

/**
 * Diameter in points of the size preview dot. Board widths run 2.5 to 10;
 * the dot is scaled up so the thinnest step is still visible, and capped to
 * fit inside a touch target.
 */
export function inkSizePreviewDiameter(size:InkSize,tool:InkTool):number{
 // The Forge board draws highlighter strokes 4.5x wider than the pen.
 const width=INK_SIZE_POINTS[size]*(tool==="highlighter"?4.5:1);
 return Math.min(28,Math.max(4,Math.round(4+width*1.6)));
}

/** The disabled reason of an {@linkcode InkAvailability}, or `undefined` when enabled. */
export function availabilityReason(state:InkAvailability):string|undefined{
 return state.enabled?undefined:state.reason;
}

/** Values {@linkcode validateInkToolbar} checks. */
export interface InkToolbarState {
 readonly tools:readonly InkToolOption[];
 readonly tool:InkTool;
 readonly size:InkSize;
 readonly swatches?:readonly InkSwatch[];
 readonly color?:string;
 readonly opacity?:number;
 readonly undo:InkAvailability;
 readonly redo:InkAvailability;
}

/**
 * Throws a RangeError when the controlled toolbar state cannot be shown
 * honestly: no tools, duplicate or unknown tools, a selected tool that is not
 * offered, an unknown size, duplicate swatch ids, a selected color with no
 * swatch, opacity outside 0..1, or a disabled control without a reason.
 */
export function validateInkToolbar(state:InkToolbarState):void{
 if(state.tools.length===0)throw new RangeError("InkToolbar needs at least one tool");
 const seen=new Set<InkTool>();
 for(const option of state.tools){
  if(!Object.hasOwn(INK_TOOL_LABELS,option.tool))throw new RangeError("Unknown ink tool: "+String(option.tool));
  if(seen.has(option.tool))throw new RangeError("Duplicate ink tool: "+option.tool);
  if(option.disabledReason!==undefined&&!option.disabledReason.trim())
   throw new RangeError("Disabled tool needs a reason: "+option.tool);
  seen.add(option.tool);
 }
 if(!seen.has(state.tool))throw new RangeError("Selected tool is not offered: "+String(state.tool));
 if(!INK_SIZES.includes(state.size))throw new RangeError("Unknown ink size: "+String(state.size));
 const ids=new Set<string>();
 for(const swatch of state.swatches??[]){
  if(!swatch.id||ids.has(swatch.id))throw new RangeError("Duplicate or empty swatch id: "+swatch.id);
  if(!swatch.label.trim())throw new RangeError("Swatch label is blank: "+swatch.id);
  ids.add(swatch.id);
 }
 if(state.color!==undefined&&!ids.has(state.color))throw new RangeError("Selected color has no swatch: "+state.color);
 if(state.opacity!==undefined&&(!Number.isFinite(state.opacity)||state.opacity<0||state.opacity>1))
  throw new RangeError("Ink opacity must be within 0..1");
 for(const [name,value] of [["undo",state.undo],["redo",state.redo]] as const){
  if(!value.enabled&&!value.reason.trim())throw new RangeError("Disabled "+name+" needs a reason");
 }
}

/**
 * What the host should do for an {@linkcode InkCommand}, given the current
 * toolbar state. A disabled target yields a `notice` carrying its reason so
 * the toolbar can say why nothing happened.
 * @see {@linkcode planInkCommand}
 */
export type InkCommandOutcome=
 |Readonly<{kind:"tool";tool:InkTool}>
 |Readonly<{kind:"size";size:InkSize}>
 |Readonly<{kind:"undo"}>
 |Readonly<{kind:"redo"}>
 |Readonly<{kind:"notice";message:string}>
 |Readonly<{kind:"none"}>;

/** Resolve an {@linkcode InkCommand} against the toolbar state without side effects. */
export function planInkCommand(command:InkCommand,state:Pick<InkToolbarState,"tools"|"tool"|"size"|"undo"|"redo">):InkCommandOutcome{
 switch(command.type){
  case "select-tool":{
   const option=state.tools.find(o=>o.tool===command.tool);
   if(option===undefined||option.tool===state.tool)return {kind:"none"};
   if(option.disabledReason!==undefined)return {kind:"notice",message:option.disabledReason};
   return {kind:"tool",tool:option.tool};
  }
  case "size":{
   const next=stepInkSize(state.size,command.direction);
   if(next===state.size)return {kind:"notice",message:command.direction>0?"Already the largest size":"Already the smallest size"};
   return {kind:"size",size:next};
  }
  case "undo":return state.undo.enabled?{kind:"undo"}:{kind:"notice",message:state.undo.reason};
  case "redo":return state.redo.enabled?{kind:"redo"}:{kind:"notice",message:state.redo.reason};
 }
}
