export type LayerAlphaMode='straight'|'premultiplied';
export interface LayerBlendValue {readonly mode:string;readonly opacity:number;readonly spaceId:string;readonly alphaMode:LayerAlphaMode}
export interface LayerBlendMode {readonly id:string;readonly label:string;readonly unavailableReason?:string}
/**
 * One alpha representation the host compositor offers for a layer, passed to
 * `LayerBlendAndOpacity` as `alphaModes`. An entry with
 * `unavailableReason` stays listed but cannot be chosen; the reason is shown
 * to the user, so write it as a sentence they can act on.
 * @see {@linkcode defaultAlphaModes}
 */
export interface LayerAlphaOption {
 /** The {@linkcode LayerBlendValue.alphaMode} this entry selects. */
 readonly id:LayerAlphaMode;
 /** Visible and spoken name, for example "Straight alpha". */
 readonly label:string;
 /** Why the compositor cannot use this representation. Omit when it can. */
 readonly unavailableReason?:string;
}
/**
 * The alpha catalog `LayerBlendAndOpacity` uses when `alphaModes` is omitted:
 * Straight and Premultiplied, both available. This is the 1.0.0-rc.1
 * behaviour.
 */
export const defaultAlphaModes=[
 {id:'straight',label:'Straight alpha'},
 {id:'premultiplied',label:'Premultiplied alpha'},
] as const satisfies readonly LayerAlphaOption[];
export interface LayerBlendSpace {
 readonly id:string;readonly label:string;readonly transfer:'linear'|'encoded';
 /** Capabilities supplied by the compositor, never inferred from a profile name. */
 readonly modeIds:readonly string[];readonly unavailableReason?:string;
}
const id=(value:string)=>typeof value==='string'&&!!value.trim()&&value.length<=512;
const reasonOk=(reason:string|undefined)=>reason===undefined||typeof reason==='string'&&!!reason.trim()&&reason.length<=1024;
/**
 * Throws `RangeError` for an invalid value or catalog. `alphaModes` is
 * optional; when given it must hold one or two entries with distinct ids from
 * {@linkcode LayerAlphaMode}, and `value.alphaMode` must be one of them.
 * @throws {RangeError} Invalid value, catalog, or a current value outside its catalog.
 */
export function validateLayerBlend(value:LayerBlendValue,modes:readonly LayerBlendMode[],spaces:readonly LayerBlendSpace[],alphaModes?:readonly LayerAlphaOption[]):void {
 if(!Number.isFinite(value.opacity)||value.opacity<0||value.opacity>1||!['straight','premultiplied'].includes(value.alphaMode)||!id(value.mode)||!id(value.spaceId))throw new RangeError('Invalid layer blend value');
 if(!modes.length||modes.length>128||!spaces.length||spaces.length>128)throw new RangeError('Invalid compositing capability count');
 const modesById=new Map<string,LayerBlendMode>(),spacesById=new Set<string>();
 for(const mode of modes){if(!id(mode.id)||!id(mode.label)||modesById.has(mode.id)||mode.unavailableReason!==undefined&&(!mode.unavailableReason.trim()||mode.unavailableReason.length>1024))throw new RangeError('Invalid blend mode');modesById.set(mode.id,mode);}
 for(const space of spaces){if(!id(space.id)||!id(space.label)||spacesById.has(space.id)||!['linear','encoded'].includes(space.transfer)||!space.modeIds.length||space.modeIds.length>modes.length||new Set(space.modeIds).size!==space.modeIds.length||space.modeIds.some(mode=>!modesById.has(mode))||space.unavailableReason!==undefined&&(!space.unavailableReason.trim()||space.unavailableReason.length>1024))throw new RangeError('Invalid compositing space');spacesById.add(space.id);}
 if(!modesById.has(value.mode)||!spacesById.has(value.spaceId))throw new RangeError('Current layer mode and space must remain in the capability catalog');
 if(alphaModes===undefined)return;
 if(!Array.isArray(alphaModes)||!alphaModes.length||alphaModes.length>2)throw new RangeError('Layer alpha catalog must list one or two representations');
 const alphaIds=new Set<string>();
 for(const alpha of alphaModes){if(!alpha||!['straight','premultiplied'].includes(alpha.id)||alphaIds.has(alpha.id)||!id(alpha.label)||!reasonOk(alpha.unavailableReason))throw new RangeError('Invalid layer alpha representation');alphaIds.add(alpha.id);}
 if(!alphaIds.has(value.alphaMode))throw new RangeError('Current layer alpha representation must remain in the alpha catalog');
}
/**
 * A retained imported value can be unavailable; show its reason without
 * pretending to convert it. Blend mode and space reasons come first, then the
 * current alpha entry's `unavailableReason` when `alphaModes` is given.
 * @throws {RangeError} As {@linkcode validateLayerBlend}.
 */
export function layerBlendProblem(value:LayerBlendValue,modes:readonly LayerBlendMode[],spaces:readonly LayerBlendSpace[],alphaModes?:readonly LayerAlphaOption[]):string|undefined {
 validateLayerBlend(value,modes,spaces,alphaModes);const mode=modes.find(mode=>mode.id===value.mode)!,space=spaces.find(space=>space.id===value.spaceId)!;
 return mode.unavailableReason??space.unavailableReason??(!space.modeIds.includes(value.mode)?'This blend mode is unavailable in the selected compositing space':undefined)??alphaModes?.find(alpha=>alpha.id===value.alphaMode)!.unavailableReason;
}
/** Six-decimal alpha survives percent entry. No pixel channels or profile IDs are converted. */
export function layerOpacityFromPercent(percent:number):number {
 if(!Number.isFinite(percent)||percent<0||percent>100)throw new RangeError('Layer opacity percent must be within 0..100');return Math.round(percent*10000)/1000000;
}
