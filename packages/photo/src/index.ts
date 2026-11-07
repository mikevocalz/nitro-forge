import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
/** Host-claimed metadata; the catalog does not decode bytes or verify content hashes. */
export interface OriginalDescriptor {sha256:string;asset_ref:string;byte_length:number;camera_make:string;camera_model:string}
export interface PhotoOriginal extends OriginalDescriptor {id:string;rating:number;labels:string[]}
/** Persistent identity/name only; no develop recipe or rendered output is implied. */
export interface PhotoVersion {id:string;original_id:string;name:string}
export interface PhotoCatalog {kind:'photo';schema:1;next_id:number;originals:Record<string,PhotoOriginal>;versions:Record<string,PhotoVersion>}
export const OPS={newDoc:'new',describe:'describe',readOriginal:'readOriginal',addOriginal:'addOriginal',removeOriginal:'removeOriginal',setRating:'setRating',setLabels:'setLabels',createVersion:'createVersion',renameVersion:'renameVersion',removeVersion:'removeVersion'} as const;
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
 save(){return this.document.snapshot();} undo(){return this.document.undo();} redo(){return this.document.redo();} close(){return this.document.close();}
}
