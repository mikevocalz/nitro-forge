import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCheckpointStore} from '../src/autosave';
import {createCollaborationCheckpointStore} from '../src/collaboration-checkpoint';
import {ENGINE_KINDS,type EngineKind} from '../src/types';
import {CliHost} from '../src/host-cli';
import {MotionDocument} from '../../motion/src/index';
it('preserves persisted tags 0..7 and appends Motion8 in both checkpoints/native enum',async()=>{
 const kinds:EngineKind[]=['prism','cadence','splice','folio','pitch','tally','quill','photo','motion'];expect(ENGINE_KINDS).toEqual(kinds);
 const snapshot=new Uint8Array([78,70,68,49,0,0,0,0,0]);
 for(const[tag,kind]of kinds.entries()){
  let bytes:Uint8Array|undefined;const storage={async read(){return bytes;},async write(_key:string,value:Uint8Array){bytes=value.slice();}};
  const nfc=createCheckpointStore(storage);await nfc.write('document',{kind,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,70,67,49,tag]);expect((await nfc.read('document'))!.bytes).toEqual(snapshot);
  const ncc=createCollaborationCheckpointStore(storage);await ncc.write('document',{version:1,documentId:'motion-doc',kind,revision:1,dirty:false,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,67,67,49,tag]);expect((await ncc.read('document'))!.kind).toBe(kind);
 }
 const header=readFileSync(new URL('../nitrogen/generated/shared/c++/include/NitroForgeV1/ForgeEngineKind.hpp',import.meta.url),'utf8');for(const[ordinal,kind]of kinds.entries())expect(header).toMatch(new RegExp(`${kind.toUpperCase()}\\s+SWIFT_NAME\\(${kind}\\) = ${ordinal},`));
});
it('opens Motion through CLI/shared snapshot helper and renders actual Prism pixels',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined,restored:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:2,height:1,duration_s:1});const layer=await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[255,0,0,255]});
  await doc.setPropertyKeys(layer.data.layer_id,'tx',[{time:0,value:0,interpolation:'linear',in_handle:null,out_handle:null},{time:1,value:1,interpolation:'linear',in_handle:null,out_handle:null}]);
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,0,0,0,0]).toString('base64'));
  expect((await doc.renderFrame(1)).data.pixels_b64).toBe(Buffer.from([0,0,0,0,255,0,0,255]).toString('base64'));
  const bytes=await doc.save();expect([...bytes.subarray(0,5)]).toEqual([78,70,68,49,0]);restored=await MotionDocument.openSnapshot(host,bytes);expect(await restored.save()).toEqual(bytes);
 }finally{await restored?.close();await doc?.close();await host.dispose();}
});
