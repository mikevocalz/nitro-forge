/** Linear-light sRGB controls, not Kelvin/tint, ICC or a complete RAW recipe. */
export interface PhotoDevelopV1 {schema:1;exposure_ev:number;contrast:number;rgb_gain:readonly [number,number,number]}
export const IDENTITY_DEVELOP:Readonly<PhotoDevelopV1>=Object.freeze({schema:1,exposure_ev:0,contrast:1,rgb_gain:Object.freeze([1,1,1] as const)});
export interface PhotoPreviewRequest {
 version_id:string;original_id:string;original_sha256:string;expected_develop:PhotoDevelopV1;
 width:number;height:number;format:'rgba8-straight-srgb';
}
export interface PhotoPreviewData {
 version_id:string;original_id:string;original_sha256:string;develop:PhotoDevelopV1;
 width:number;height:number;row_stride:number;format:'rgba8-straight-srgb';pixels_b64?:string;
}
/** Own the admitted recipe rather than silently dropping unsupported processing fields. */
export function ownDevelopRecipe(value:PhotoDevelopV1):PhotoDevelopV1 {
 if(!value||Object.keys(value).some(key=>!['schema','exposure_ev','contrast','rgb_gain'].includes(key))||value.schema!==1||!Number.isFinite(value.exposure_ev)||value.exposure_ev< -8||value.exposure_ev>8||!Number.isFinite(value.contrast)||value.contrast<0||value.contrast>4||!Array.isArray(value.rgb_gain)||value.rgb_gain.length!==3||value.rgb_gain.some(gain=>!Number.isFinite(gain)||gain<0||gain>8))throw new TypeError('Unsupported or invalid develop recipe');
 return {schema:1,exposure_ev:value.exposure_ev,contrast:value.contrast,rgb_gain:[value.rgb_gain[0],value.rgb_gain[1],value.rgb_gain[2]]};
}
/** Copy request data before transport awaits; caller owns original-byte provenance and job admission. */
export function ownPreviewRequest(request:PhotoPreviewRequest):PhotoPreviewRequest {
 const {width,height}=request;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>4096||height>4096||width*height>1_048_576)throw new RangeError('Preview exceeds the 1 MP / 4096-side budget');
 return {version_id:request.version_id,original_id:request.original_id,original_sha256:request.original_sha256,
  expected_develop:ownDevelopRecipe(request.expected_develop),width,height,format:request.format};
}
export type PhotoPreviewResult={data:PhotoPreviewData;pixels:Uint8Array};
