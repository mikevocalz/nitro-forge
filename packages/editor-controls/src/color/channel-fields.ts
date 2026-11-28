import {assertHsv,hsvToRgb,rgbaEditToHsv,wrapHue,type HsvColor} from "../color.ts";
import {hslToHsv,hsvToHsl} from "./hsl.ts";

/** Channel sets offered by `ColorChannelFields`. */
export type ChannelModel="rgb"|"hsl"|"hsv";
/** Every {@linkcode ChannelModel} with its tab label, in tab order. */
export const CHANNEL_MODELS=[
  {model:"rgb",label:"RGB"},{model:"hsl",label:"HSL"},{model:"hsv",label:"HSV"},
] as const satisfies readonly {model:ChannelModel;label:string}[];

/** One numeric field of a {@linkcode ChannelModel}. */
export interface ChannelField {
  /** Field label and screen-reader name, e.g. "Red". */
  readonly label:string;
  readonly max:number;
  /** Unit shown after the value. */
  readonly unit:""|"°"|"%";
}

const FIELDS:Record<ChannelModel,readonly [ChannelField,ChannelField,ChannelField]>={
  rgb:[{label:"Red",max:255,unit:""},{label:"Green",max:255,unit:""},{label:"Blue",max:255,unit:""}],
  hsl:[{label:"Hue",max:359,unit:"°"},{label:"Saturation",max:100,unit:"%"},{label:"Lightness",max:100,unit:"%"}],
  hsv:[{label:"Hue",max:359,unit:"°"},{label:"Saturation",max:100,unit:"%"},{label:"Brightness",max:100,unit:"%"}],
};

/** The three fields of `model`. */
export const channelFields=(model:ChannelModel)=>FIELDS[model];

/**
 * Displayed integers for `model`. Hue that rounds to 360 shows as 0, matching
 * `HsvPicker`'s label.
 */
export function readChannels(value:HsvColor,model:ChannelModel):[number,number,number]{
  assertHsv(value);
  const hue=Math.round(wrapHue(value.h))%360;
  if(model==="rgb"){const c=hsvToRgb(value);return [c.r,c.g,c.b];}
  if(model==="hsl"){const c=hsvToHsl(value);return [hue,Math.round(c.s*100),Math.round(c.l*100)];}
  return [hue,Math.round(value.s*100),Math.round(value.v*100)];
}

/**
 * `value` with field `index` of `model` set to `n` (already range-checked).
 * The other two channels keep their exact floating values, so typing one field
 * never nudges the others by display rounding, and gray keeps its hue.
 */
export function writeChannel(value:HsvColor,model:ChannelModel,index:0|1|2,n:number):HsvColor{
  assertHsv(value);
  if(model==="rgb"){
    const c=hsvToRgb(value);
    const next={...c,[(["r","g","b"] as const)[index]]:n};
    return rgbaEditToHsv(next,value);
  }
  if(model==="hsl"){
    const c=hsvToHsl(value);
    const next=index===0?{...c,h:n}:index===1?{...c,s:n/100}:{...c,l:n/100};
    // HSL has no saturation at black/white and HSV none at black; keep what the user set.
    const hsv=hslToHsv(next);
    return {...hsv,h:index===0?n:wrapHue(value.h)};
  }
  return index===0?{...value,h:n}:index===1?{...value,s:n/100}:{...value,v:n/100};
}

/** A typed field value as an integer within `0..max`, or `undefined` if it is not one. */
export function parseChannel(text:string,max:number):number|undefined{
  const m=/^\s*(\d{1,3})\s*[°%]?\s*$/.exec(text);
  if(!m)return undefined;
  const n=Number(m[1]);
  return n<=max?n:undefined;
}

/** Parses a typed opacity: a whole or decimal percent, `%` optional. */
export function parseOpacityPercent(text:string):number|undefined{
  const m=/^\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$/.exec(text);
  if(!m)return undefined;
  const n=Number(m[1]);
  return n>=0&&n<=100?n:undefined;
}
