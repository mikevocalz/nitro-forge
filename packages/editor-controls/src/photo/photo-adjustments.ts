/** Non-destructive, versioned settings. Processing and original pixels stay in the host. */
export interface ExposureSettings {readonly exposure:number;readonly temperature:number;readonly tint:number;readonly highlights:number;readonly shadows:number}
export interface ToneSettings {readonly contrast:number;readonly texture:number;readonly clarity:number;readonly dehaze:number;readonly vibrance:number}
export const PHOTO_BANDS=['red','orange','yellow','green','aqua','blue','purple','magenta'] as const;
export type PhotoBand=typeof PHOTO_BANDS[number];
export interface BandAdjustment {readonly hue:number;readonly saturation:number;readonly luminance:number}
export type EightBandSettings=Readonly<Record<PhotoBand,BandAdjustment>>;
export interface LensSettings {readonly enabled:boolean;readonly profileId:string|null;readonly distortion:number;readonly chromaticAberration:boolean}
export interface PhotoDevelopSettings {readonly version:1;readonly exposure:ExposureSettings;readonly tone:ToneSettings;readonly mixer:EightBandSettings;readonly lens:LensSettings}
export interface PhotoRating {readonly stars:0|1|2|3|4|5;readonly label:'none'|'red'|'yellow'|'green'|'blue'|'purple';readonly flag:'none'|'pick'|'reject'}
export const EXPOSURE_FIELDS=[['exposure','Exposure EV',-10,10,.1],['temperature','Temperature kelvin',1000,50000,100],['tint','White balance tint',-150,150,1],['highlights','Highlights',-100,100,1],['shadows','Shadows',-100,100,1]] as const;
export const TONE_FIELDS=[['contrast','Contrast',-100,100,1],['texture','Texture',-100,100,1],['clarity','Clarity',-100,100,1],['dehaze','Dehaze',-100,100,1],['vibrance','Vibrance',-100,100,1]] as const;
const object=(v:unknown,name:string):Record<string,unknown>=>{if(typeof v!=='object'||v===null||Array.isArray(v))throw new TypeError(`Invalid ${name}`);return v as Record<string,unknown>;};
const number=(v:unknown,min:number,max:number,name:string):number=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new RangeError(`${name} must be ${min}..${max}`);return v;};
export function validateExposure(value:ExposureSettings):void {const v=object(value,'exposure');for(const [key,label,min,max] of EXPOSURE_FIELDS)number(v[key],min,max,label);}
export function validateTone(value:ToneSettings):void {const v=object(value,'tone');for(const [key,label,min,max] of TONE_FIELDS)number(v[key],min,max,label);}
export function validateEightBand(value:EightBandSettings):void {const v=object(value,'eight-band mixer');for(const key of PHOTO_BANDS){const b=object(v[key],key);for(const channel of ['hue','saturation','luminance'])number(b[channel],-100,100,`${key} ${channel}`);}}
export function validateLens(value:LensSettings):void {const v=object(value,'lens');if(typeof v.enabled!=='boolean'||typeof v.chromaticAberration!=='boolean')throw new TypeError('Invalid lens switches');if(v.profileId!==null&&(typeof v.profileId!=='string'||!v.profileId.trim()||v.profileId.length>256))throw new TypeError('Invalid lens profile identity');number(v.distortion,-100,100,'Lens distortion');}
export function validatePhotoRating(value:PhotoRating):void {const v=object(value,'photo rating');if(!Number.isInteger(v.stars)||!['none','red','yellow','green','blue','purple'].includes(v.label as string)||!['none','pick','reject'].includes(v.flag as string))throw new TypeError('Invalid photo rating');number(v.stars,0,5,'Stars');}
export function validatePhotoDevelop(value:PhotoDevelopSettings):void {const v=object(value,'develop settings');if(v.version!==1)throw new RangeError('Unsupported photo settings version');validateExposure(value.exposure);validateTone(value.tone);validateEightBand(value.mixer);validateLens(value.lens);}
/** Fresh settings, including independent objects for each band. */
export function defaultPhotoDevelop():PhotoDevelopSettings {return {version:1,exposure:{exposure:0,temperature:6500,tint:0,highlights:0,shadows:0},tone:{contrast:0,texture:0,clarity:0,dehaze:0,vibrance:0},mixer:Object.fromEntries(PHOTO_BANDS.map(key=>[key,{hue:0,saturation:0,luminance:0}])) as unknown as EightBandSettings,lens:{enabled:false,profileId:null,distortion:0,chromaticAberration:false}};}
/** Normalize only schema fields; discard unknown properties without assigning them to objects. */
function normalize(value:PhotoDevelopSettings):PhotoDevelopSettings {validatePhotoDevelop(value);return {version:1,exposure:Object.fromEntries(EXPOSURE_FIELDS.map(([key])=>[key,value.exposure[key]])) as unknown as ExposureSettings,tone:Object.fromEntries(TONE_FIELDS.map(([key])=>[key,value.tone[key]])) as unknown as ToneSettings,mixer:Object.fromEntries(PHOTO_BANDS.map(key=>[key,{hue:value.mixer[key].hue,saturation:value.mixer[key].saturation,luminance:value.mixer[key].luminance}])) as unknown as EightBandSettings,lens:{enabled:value.lens.enabled,profileId:value.lens.profileId,distortion:value.lens.distortion,chromaticAberration:value.lens.chromaticAberration}};}
export function serializePhotoDevelop(value:PhotoDevelopSettings):string {return JSON.stringify(normalize(value));}
/** A bounded interchange payload, not arbitrary executable presets or an image file. */
export function parsePhotoDevelop(text:string):PhotoDevelopSettings {if(typeof text!=='string'||text.length>65536)throw new RangeError('Photo settings payload exceeds 64 KiB');return normalize(JSON.parse(text) as PhotoDevelopSettings);}
