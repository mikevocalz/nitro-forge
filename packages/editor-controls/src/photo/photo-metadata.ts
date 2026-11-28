export interface PhotoProvenanceEntry {readonly id:string;readonly label:string;readonly value:string}
/** Values are supplied by the metadata/provenance provider; null means unrecorded. */
export interface PhotoMetadata {
 readonly photoId:string;readonly revision:string|number;readonly fileName:string;readonly mimeType:string|null;
 readonly dimensions:{readonly width:number;readonly height:number}|null;
 readonly cameraMaker:string|null;readonly cameraModel:string|null;readonly lens:string|null;readonly capturedAt:string|null;
 readonly exposureSeconds:number|null;readonly aperture:number|null;readonly iso:number|null;readonly focalLengthMm:number|null;
 readonly provenance:readonly PhotoProvenanceEntry[];
}
export function validatePhotoMetadata(value:PhotoMetadata):void {
 if(!value.photoId.trim()||value.photoId.length>256||!value.fileName.trim()||value.fileName.length>1024||!(typeof value.revision==='string'||Number.isSafeInteger(value.revision)))throw new TypeError('Invalid photo metadata identity');
 for(const key of ['mimeType','cameraMaker','cameraModel','lens','capturedAt'] as const)if(value[key]!==null&&(typeof value[key]!=='string'||value[key]!.length>4096))throw new RangeError(`Invalid metadata ${key}`);
 for(const key of ['exposureSeconds','aperture','iso','focalLengthMm'] as const)if(value[key]!==null&&(!Number.isFinite(value[key])||value[key]!<=0))throw new RangeError(`Invalid metadata ${key}`);
 if(value.dimensions!==null&&(!Number.isSafeInteger(value.dimensions.width)||!Number.isSafeInteger(value.dimensions.height)||value.dimensions.width<1||value.dimensions.height<1))throw new RangeError('Invalid photo dimensions');
 if(value.provenance.length>1000)throw new RangeError('Too many provenance entries');const ids=new Set<string>();for(const entry of value.provenance){if(!entry.id.trim()||ids.has(entry.id)||!entry.label.trim()||entry.label.length>256||typeof entry.value!=='string'||entry.value.length>4096)throw new TypeError('Invalid provenance entry');ids.add(entry.id);}
}
