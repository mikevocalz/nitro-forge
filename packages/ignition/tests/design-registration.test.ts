import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCheckpointStore} from '../src/autosave';
import {createCollaborationCheckpointStore} from '../src/collaboration-checkpoint';
import {ENGINE_KINDS,type EngineKind} from '../src/types';
import {CliHost} from '../src/host-cli';
import {DesignDocument} from '../../design/src/index';
it('preserves all prior tags and appends Design9 in checkpoints and generated native enum',async()=>{
 const kinds:EngineKind[]=['prism','cadence','splice','folio','pitch','tally','quill','photo','motion','design'];expect(ENGINE_KINDS).toEqual(kinds);
 const snapshot=new Uint8Array([78,70,68,49,0,0,0,0,0]);
 for(const[tag,kind]of kinds.entries()){
  let bytes:Uint8Array|undefined;const storage={async read(){return bytes;},async write(_key:string,value:Uint8Array){bytes=Uint8Array.from(value);}};
  const nfc=createCheckpointStore(storage);await nfc.write('document',{kind,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,70,67,49,tag]);expect((await nfc.read('document'))!.kind).toBe(kind);
  const ncc=createCollaborationCheckpointStore(storage);await ncc.write('document',{version:1,documentId:'design-doc',kind,revision:1,dirty:false,bytes:snapshot});expect([...bytes!.subarray(0,5)]).toEqual([78,67,67,49,tag]);expect((await ncc.read('document'))!.bytes).toEqual(snapshot);
 }
 const header=readFileSync(new URL('../nitrogen/generated/shared/c++/include/NitroForgeV1/ForgeEngineKind.hpp',import.meta.url),'utf8');for(const[ordinal,kind]of kinds.entries())expect(header).toMatch(new RegExp(`${kind.toUpperCase()}\\s+SWIFT_NAME\\(${kind}\\) = ${ordinal},`));
});
it('opens registered Design through CLI, evaluates flow and saves/reopens actual RGBA output',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,restored:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:3,height:1});await doc.addShape(1,'rect',{width:1,height:1,fill:[7,8,9,255]});
  await doc.setFrameLayout(1,{direction:'row',gap:0,padding_top:0,padding_right:0,padding_bottom:0,padding_left:0,align:'start',justify:'end'});
  const boxes=(await doc.evaluateLayout()).data.boxes;expect(boxes[1]!.x).toBe(2);
  expect((await doc.renderFrame()).data.pixels_b64).toBe(Buffer.from([0,0,0,0,0,0,0,0,7,8,9,255]).toString('base64'));
  const bytes=await doc.save();restored=await DesignDocument.openSnapshot(host,bytes);expect(await restored.save()).toEqual(bytes);
  const foreign=await host.open('motion');try{await expect(restored.handle.restore(await host.snapshot(foreign))).rejects.toThrow();}finally{await host.close(foreign);}expect(await restored.save()).toEqual(bytes);
 }finally{await restored?.close();await doc?.close();await host.dispose();}
});
