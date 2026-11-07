import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCheckpointStore} from '../src/autosave';
import {createCollaborationCheckpointStore} from '../src/collaboration-checkpoint';
import {ENGINE_KINDS,type EngineKind} from '../src/types';
import {CliHost} from '../src/host-cli';
import {DraftDocument} from '../../draft/src/index';
it('preserves persisted tags0..9 and appends Draft10 in checkpoints/native enum',async()=>{
 const kinds:EngineKind[]=['prism','cadence','splice','folio','pitch','tally','quill','photo','motion','design','draft'];expect(ENGINE_KINDS).toEqual(kinds);
 const snapshot=new Uint8Array([78,70,68,49,0,0,0,0,0]);
 for(const[tag,kind]of kinds.entries()){
  let bytes:Uint8Array|undefined;const storage={async read(){return bytes;},async write(_key:string,value:Uint8Array){bytes=value.slice();}};
  const nfc=createCheckpointStore(storage);await nfc.write('document',{kind,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,70,67,49,tag]);expect((await nfc.read('document'))!.bytes).toEqual(snapshot);
  const ncc=createCollaborationCheckpointStore(storage);await ncc.write('document',{version:1,documentId:'draft-doc',kind,revision:1,dirty:false,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,67,67,49,tag]);expect((await ncc.read('document'))!.kind).toBe(kind);
 }
 const header=readFileSync(new URL('../nitrogen/generated/shared/c++/include/NitroForgeV1/ForgeEngineKind.hpp',import.meta.url),'utf8');for(const[ordinal,kind]of kinds.entries())expect(header).toMatch(new RegExp(`${kind.toUpperCase()}\\s+SWIFT_NAME\\(${kind}\\) = ${ordinal},`));
});
it('opens Draft through CLI, solves actual geometry and renders/owns restored snapshots',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,restored:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);const a=(await doc.addPoint(0,0.5)).data.point_id;const b=(await doc.addPoint(3,1)).data.point_id;const ab=(await doc.addSegment(a,b,{color:[255,0,0,255]})).data.segment_id;
  await doc.addConstraint({kind:'fixed',point:a,x:0,y:0.5});await doc.addConstraint({kind:'horizontal',segment:ab});
  const solved=await doc.solve();expect(solved.data.status).toBe('underconstrained');expect(solved.data.residual).toBe(0);expect((await doc.describe()).data.points[String(b)]!.y).toBe(0.5);
  expect((await doc.renderFrame({width:3,height:1,origin_x:0,origin_y:0,scale:1})).data.pixels_b64).toBe(Buffer.from([255,0,0,255,255,0,0,255,255,0,0,255]).toString('base64'));
  const bytes=await doc.save();expect([...bytes.subarray(0,5)]).toEqual([78,70,68,49,0]);restored=await DraftDocument.openSnapshot(host,bytes);expect(await restored.save()).toEqual(bytes);
  const snap=await doc.querySnap(0,0.5,0.01);expect(snap.data.candidate!.kind).toBe('endpoint');expect(snap.data.source_revision).toBe((await doc.describe()).data.source_revision);
 }finally{await restored?.close();await doc?.close();await host.dispose();}
});
