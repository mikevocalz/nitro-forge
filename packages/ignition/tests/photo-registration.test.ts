import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCheckpointStore} from '../src/autosave';
import {createCollaborationCheckpointStore} from '../src/collaboration-checkpoint';
import {ENGINE_KINDS,type EngineKind} from '../src/types';
import {DocumentHandle} from '../src/document';
import {CliHost} from '../src/host-cli';

it('preserves all seven persisted tags and appends photo as tag 7 in both formats',async()=>{
 const kinds:EngineKind[]=['prism','cadence','splice','folio','pitch','tally','quill','photo'];
 expect(ENGINE_KINDS).toEqual(kinds);
 const snapshot=new Uint8Array([78,70,68,49,0,0,0,0,0]);
 for(const [tag,kind] of kinds.entries()){
  let bytes:Uint8Array|undefined;
  const storage={async read(){return bytes;},async write(_key:string,value:Uint8Array){bytes=value.slice();}};
  const nfc=createCheckpointStore(storage);
  await nfc.write('document',{kind,bytes:snapshot});
  expect([...bytes!.subarray(0,5)]).toEqual([78,70,67,49,tag]);
  expect(bytes!.subarray(5)).toEqual(snapshot);
  expect(await nfc.read('document')).toEqual({kind,bytes:snapshot});
  const ncc=createCollaborationCheckpointStore(storage);
  await ncc.write('document',{version:1,documentId:'photo-doc',kind,revision:1,dirty:false,bytes:snapshot});
  expect([...bytes!.subarray(0,5)]).toEqual([78,67,67,49,tag]);
  expect((await ncc.read('document'))!.kind).toBe(kind);
  expect((await ncc.read('document'))!.bytes).toEqual(snapshot);
 }
 const header=readFileSync(new URL('../nitrogen/generated/shared/c++/include/NitroForgeV1/ForgeEngineKind.hpp',import.meta.url),'utf8');
 for(const [ordinal,kind] of kinds.entries())expect(header).toMatch(new RegExp(`${kind.toUpperCase()}\\s+SWIFT_NAME\\(${kind}\\) = ${ordinal},`));
});

it('opens the registered photo engine through CLI, persists metadata and rejects foreign restore',async()=>{
 const host=new CliHost();let doc:DocumentHandle|undefined;let reopened:DocumentHandle|undefined;
 try{
  doc=await DocumentHandle.open(host,'photo');
  const response=await doc.apply<{original_id:string}>('addOriginal',{sha256:'a'.repeat(64),asset_ref:'asset:durable-1',byte_length:123,camera_make:'Pentax',camera_model:'K-7'});
  await doc.apply('setRating',{id:response.data.original_id,rating:4});
  const bytes=await doc.snapshot();reopened=await DocumentHandle.open(host,'photo');await reopened.restore(bytes);
  expect((await reopened.apply<{original:{rating:number}}>('readOriginal',{id:response.data.original_id})).data.original.rating).toBe(4);
  const foreign=await DocumentHandle.open(host,'tally');try{await expect(reopened.restore(await foreign.snapshot())).rejects.toThrow();}finally{await foreign.close();}
  expect(await reopened.snapshot()).toEqual(bytes);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
