import {ownDevelopRecipe,ownPreviewRequest,type PhotoDevelopV1,type PhotoPreviewRequest,type PhotoPreviewData,type PhotoPreviewResult} from './develop';
export * from './develop';
import {DocumentHandle,bytesToBase64,base64ToBytes,type EngineHost} from '@nitro-forge/ignition';
/** Host-claimed metadata; the catalog does not decode bytes or verify content hashes. */
export interface OriginalDescriptor {sha256:string;asset_ref:string;byte_length:number;camera_make:string;camera_model:string}
export interface PhotoOriginal extends OriginalDescriptor {id:string;rating:number;labels:string[]}
/** Version identity with an optional nonidentity develop recipe; omitted means identity. */
export interface PhotoVersion {develop?:PhotoDevelopV1;id:string;original_id:string;name:string}
export interface PhotoCatalog {kind:'photo';schema:1;next_id:number;originals:Record<string,PhotoOriginal>;versions:Record<string,PhotoVersion>}
export const OPS={newDoc:'new',describe:'describe',readOriginal:'readOriginal',addOriginal:'addOriginal',removeOriginal:'removeOriginal',setRating:'setRating',setLabels:'setLabels',createVersion:'createVersion',renameVersion:'renameVersion',removeVersion:'removeVersion',setDevelop:'setDevelop',readDevelop:'readDevelop',processPreview:'processPreview'} as const;
export class PhotoDocument {
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost):Promise<PhotoDocument>{
  return new PhotoDocument(await DocumentHandle.openInitialized(host,'photo',doc=>doc.apply(OPS.newDoc,{})));
 }
 static async openSnapshot(host:EngineHost,bytes:Uint8Array):Promise<PhotoDocument>{
  return new PhotoDocument(await DocumentHandle.openSnapshot(host,'photo',bytes));
 }
 get handle(){return this.document;}
 describe(){return this.document.apply<PhotoCatalog>(OPS.describe,{});}
 readOriginal(id:string){return this.document.apply<{original:PhotoOriginal;versions:PhotoVersion[]}>(OPS.readOriginal,{id});}
 addOriginal(descriptor:OriginalDescriptor){return this.document.apply<{original_id:string;version_id:string}>(OPS.addOriginal,descriptor);}
 /** Removes catalog records only; never deletes host-owned original bytes. */
 removeOriginal(id:string){return this.document.apply<{ok:boolean}>(OPS.removeOriginal,{id});}
 setRating(id:string,rating:number){return this.document.apply<{ok:boolean}>(OPS.setRating,{id,rating});}
 setLabels(id:string,labels:readonly string[]){return this.document.apply<{ok:boolean}>(OPS.setLabels,{id,labels});}
 createVersion(original_id:string,name:string){return this.document.apply<{version_id:string}>(OPS.createVersion,{original_id,name});}
 renameVersion(id:string,name:string){return this.document.apply<{ok:boolean}>(OPS.renameVersion,{id,name});}
 removeVersion(id:string){return this.document.apply<{ok:boolean}>(OPS.removeVersion,{id});}
 readDevelop(id:string){return this.document.apply<{develop:PhotoDevelopV1}>(OPS.readDevelop,{id});}
 setDevelop(id:string,develop:PhotoDevelopV1){
  const owned=ownDevelopRecipe(develop);
  return this.document.apply<{ok:boolean}>(OPS.setDevelop,{id,develop:owned});
 }
 /** JSON facade for existing EngineHost; native raw document consumers may use the real binary sidecar op. */
 async processPreview(request:PhotoPreviewRequest,pixels:Uint8Array):Promise<PhotoPreviewResult>{
  const owned=ownPreviewRequest(request);
  if(pixels.byteLength!==owned.width*owned.height*4)throw new RangeError('Preview must be packed RGBA8');
  const encoded=bytesToBase64(Uint8Array.from(pixels));
  const response=await this.document.apply<PhotoPreviewData>(OPS.processPreview,{...owned,pixels_b64:encoded});
  const data=response.data;
  if(data.format!==owned.format||data.width!==owned.width||data.height!==owned.height||data.row_stride!==owned.width*4||data.original_id!==owned.original_id||data.version_id!==owned.version_id||data.original_sha256!==owned.original_sha256||typeof data.pixels_b64!=='string')throw new Error('Mismatched photo preview response');
  if(!data.develop||data.develop.schema!==owned.expected_develop.schema||data.develop.exposure_ev!==owned.expected_develop.exposure_ev||data.develop.contrast!==owned.expected_develop.contrast||!Array.isArray(data.develop.rgb_gain)||data.develop.rgb_gain.length!==3||data.develop.rgb_gain.some((gain,index)=>gain!==owned.expected_develop.rgb_gain[index]))throw new Error('Mismatched preview develop recipe');
  if(data.pixels_b64.length!==Math.ceil(owned.width*owned.height*4/3)*4)throw new Error('Photo preview response exceeds encoded byte budget');
  const output=base64ToBytes(data.pixels_b64);
  if(output.byteLength!==owned.width*owned.height*4)throw new Error('Invalid photo preview byte length');
  return {data,pixels:output};
 }
 save(){return this.document.snapshot();} undo(){return this.document.undo();} redo(){return this.document.redo();} close(){return this.document.close();}
}
