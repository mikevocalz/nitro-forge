export type ForgeIconVariant="outline"|"filled";
export type ForgeIconState="idle"|"hover"|"pressed"|"selected"|"disabled"|"loading"|"success"|"error"|"recording";
export type ForgeIconSize="xs"|"sm"|"toolbar"|"default"|"touch"|"feature"|"hero";
export interface ForgeIconOptions {
 selected?:boolean;disabled?:boolean;loading?:boolean;hovered?:boolean;pressed?:boolean;
 status?:"idle"|"success"|"error"|"recording";size?:number|ForgeIconSize;
 color?:string;selectedColor?:string;disabledColor?:string;successColor?:string;
 errorColor?:string;appearance?:"light"|"dark";reducedMotion?:boolean;
}
export interface ForgeIconPresentation {
 readonly state:ForgeIconState;readonly variant:ForgeIconVariant;readonly color:string;
 readonly size:number;readonly opacity:number;readonly animated:boolean;readonly durationMs:number;
}
export const iconGroups:Readonly<Record<string,string>>;
export const iconCategories:readonly string[];
export const iconIds:readonly string[];
export function hasIconId(id:string):boolean;
export function getIconMetadata(id:string):Readonly<{id:string;category:string;slug:string;label:string}>|undefined;
export function iconsInCategory(category:string):string[];
export function searchIcons(query:string):string[];
export const glyphIds:readonly string[];
export const glyphs:Readonly<Record<string,{outline:readonly (readonly string[])[];filled:readonly (readonly string[])[]}>>;
export function getGlyph(id:string,variant?:ForgeIconVariant):readonly (readonly string[])[]|undefined;
export const iconColors:Readonly<Record<string,string>>;
export const iconSizes:Readonly<Record<string,number>>;
export const iconStroke:Readonly<{size:number;width:number;cap:string;join:string}>;
export const iconMotion:Readonly<Record<string,number>>;
export const iconStates:readonly ForgeIconState[];
export function resolveIconState(options?:ForgeIconOptions):ForgeIconPresentation;
export function riveIconInputs(options?:ForgeIconOptions):Readonly<Record<string,string|boolean>>;
