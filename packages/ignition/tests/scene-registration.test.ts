import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCheckpointStore} from '../src/autosave';
import {createCollaborationCheckpointStore} from '../src/collaboration-checkpoint';
import {ENGINE_KINDS,type EngineKind} from '../src/types';
import {CliHost} from '../src/host-cli';
import {SceneDocument} from '../../scene/src/index';
it('preserves persisted tags0..10 and appends Scene11 in checkpoints/native enum',async()=>{
 const kinds:EngineKind[]=['prism','cadence','splice','folio','pitch','tally','quill','photo','motion','design','draft','scene'];expect(ENGINE_KINDS).toEqual(kinds);
 const snapshot=new Uint8Array([78,70,68,49,0,0,0,0,0]);
 for(const[tag,kind]of kinds.entries()){
  let bytes:Uint8Array|undefined;const storage={async read(){return bytes;},async write(_key:string,value:Uint8Array){bytes=value.slice();}};
  const nfc=createCheckpointStore(storage);await nfc.write('document',{kind,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,70,67,49,tag]);expect((await nfc.read('document'))!.bytes).toEqual(snapshot);
  const ncc=createCollaborationCheckpointStore(storage);await ncc.write('document',{version:1,documentId:'scene-doc',kind,revision:1,dirty:false,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,67,67,49,tag]);expect((await ncc.read('document'))!.kind).toBe(kind);
 }
 const header=readFileSync(new URL('../nitrogen/generated/shared/c++/include/NitroForgeV1/ForgeEngineKind.hpp',import.meta.url),'utf8');for(const[ordinal,kind]of kinds.entries())expect(header).toMatch(new RegExp(`${kind.toUpperCase()}\\s+SWIFT_NAME\\(${kind}\\) = ${ordinal},`));
});
it('opens Scene through CLI, builds a lit scene and saves/reopens the snapshot',async()=>{
 const host=new CliHost();let doc:SceneDocument|undefined,restored:SceneDocument|undefined;
 try{
  doc=await SceneDocument.open(host,'reg');
  const mat=(await doc.addMaterial({name:'m',color:[1,0,0]})).data.material_id;
  const mesh=(await doc.addMeshPrimitive({kind:'box',material:mat})).data.mesh_id;
  await doc.addNode({kind:'camera',camera:{type:'perspective'},translation:[0,0,5]});
  await doc.addNode({kind:'light',light:{type:'ambient',intensity:0.5}});
  const box=(await doc.addNode({kind:'mesh',mesh})).data.node_id;
  expect((await doc.pick([0,0,5],[0,0,-1])).data.hit?.node_id).toBe(box);
  const bytes=await doc.save();expect([...bytes.subarray(0,5)]).toEqual([78,70,68,49,0]);
  restored=await SceneDocument.openSnapshot(host,bytes);expect(await restored.save()).toEqual(bytes);
  const frame=(await restored.renderFrame({width:8,height:8})).data as {meshes:unknown[]};
  expect(frame.meshes).toHaveLength(1);
 }finally{await restored?.close();await doc?.close();await host.dispose();}
});
