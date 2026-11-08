import {expect,it,vi} from 'vitest';
import {PhotoDocument,IDENTITY_DEVELOP,type PhotoDevelopV1,type PhotoPreviewRequest} from '../src/index';
import {CliHost} from '../../ignition/src/host-cli';
import type {EngineHost} from '../../ignition/src/host';
const recipe:PhotoDevelopV1={schema:1,exposure_ev:1,contrast:1,rgb_gain:[1,1,1]};
const request=(expected:PhotoDevelopV1):PhotoPreviewRequest=>({version_id:'version-2',original_id:'original-1',original_sha256:'a'.repeat(64),expected_develop:expected,width:1,height:1,format:'rgba8-straight-srgb'});

it('processes actual pixels with persisted recipes through CLI, undo and snapshot reopen',async()=>{
 const host=new CliHost();let document:PhotoDocument|undefined;let reopened:PhotoDocument|undefined;
 try{
  document=await PhotoDocument.open(host);
  await document.addOriginal({sha256:'a'.repeat(64),asset_ref:'retained:raw',byte_length:20,camera_make:'Pentax',camera_model:'K-7'});
  expect((await document.readDevelop('version-2')).data.develop).toEqual(IDENTITY_DEVELOP);
  await document.setDevelop('version-2',recipe);
  const input=new Uint8Array([128,64,32,99]);
  expect((await document.processPreview(request(recipe),input)).pixels).toEqual(new Uint8Array([176,90,47,99]));
  expect(input).toEqual(new Uint8Array([128,64,32,99]));
  const snapshot=await document.save();
  await document.setDevelop('version-2',IDENTITY_DEVELOP);
  expect((await document.processPreview(request(IDENTITY_DEVELOP),input)).pixels).toEqual(input);
  await document.undo();
  expect((await document.processPreview(request(recipe),input)).pixels).toEqual(new Uint8Array([176,90,47,99]));
  reopened=await PhotoDocument.openSnapshot(host,snapshot);
  expect((await reopened.readDevelop('version-2')).data.develop).toEqual(recipe);
  expect((await reopened.processPreview(request(recipe),input)).pixels).toEqual(new Uint8Array([176,90,47,99]));
  await expect(reopened.processPreview({...request(recipe),original_sha256:'b'.repeat(64)},input)).rejects.toThrow('identity mismatch');
 }finally{await reopened?.close();await document?.close();await host.dispose();}
});

it('owns the exact Buffer view and recipe before asynchronous transport, rejecting oversized requests early',async()=>{
 let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});
 const apply=vi.fn(async(_id:number,command:{op:string;payload?:unknown})=>{
  if(command.op==='new')return{data:{ok:true},events:[]};
  await gate;const p=command.payload as Record<string,unknown>;
  return{data:{...p,develop:p.expected_develop,row_stride:4},events:[]};
 });
 const host={open:vi.fn(async()=>8),apply,close:vi.fn(async()=>true)} as unknown as EngineHost;
 const doc=await PhotoDocument.open(host);
 const mutableRecipe:PhotoDevelopV1={schema:1,exposure_ev:0,contrast:1,rgb_gain:[1,1,1]};
 const req=request(mutableRecipe);const backing=Buffer.from([91,128,64,32,99,92]);
 const pending=doc.processPreview(req,backing.subarray(1,5));
 backing.fill(0);req.original_sha256='b'.repeat(64);mutableRecipe.exposure_ev=2;
 finish();expect((await pending).pixels).toEqual(new Uint8Array([128,64,32,99]));
 const calls=apply.mock.calls.length;
 await expect(doc.processPreview({...request(recipe),width:4097},new Uint8Array())).rejects.toThrow('budget');
 expect(apply).toHaveBeenCalledTimes(calls);await doc.close();
});

it('rejects oversized encoded responses before decoding a declared tiny preview',async()=>{
 const apply=vi.fn(async(_id:number,command:{op:string;payload?:unknown})=>{
  if(command.op==='new')return{data:{ok:true},events:[]};
  return{data:{...request(IDENTITY_DEVELOP),develop:IDENTITY_DEVELOP,row_stride:4,pixels_b64:'A'.repeat(10000)},events:[]};
 });
 const host={open:vi.fn(async()=>8),apply,close:vi.fn(async()=>true)} as unknown as EngineHost;
 const doc=await PhotoDocument.open(host);
 await expect(doc.processPreview(request(IDENTITY_DEVELOP),new Uint8Array([1,2,3,4]))).rejects.toThrow('encoded byte budget');
 await doc.close();
});

it('processes white balance and tint through CLI with persisted recipes, undo and reopen',async()=>{
 const host=new CliHost();let document:PhotoDocument|undefined;let reopened:PhotoDocument|undefined;
 try{
  document=await PhotoDocument.open(host);
  await document.addOriginal({sha256:'a'.repeat(64),asset_ref:'retained:raw',byte_length:20,camera_make:'Pentax',camera_model:'K-7'});
  const wb:PhotoDevelopV1={schema:1,exposure_ev:0,contrast:1,rgb_gain:[1,1,1],temperature_kelvin:2500,tint:0.5};
  await document.setDevelop('version-2',wb);
  expect((await document.readDevelop('version-2')).data.develop).toEqual(wb);
  const input=new Uint8Array([200,100,50,255]);
  expect((await document.processPreview(request(wb),input)).pixels).toEqual(new Uint8Array([200,109,95,255]));
  const snapshot=await document.save();
  await document.undo();
  expect((await document.readDevelop('version-2')).data.develop).toEqual(IDENTITY_DEVELOP);
  await document.redo();
  reopened=await PhotoDocument.openSnapshot(host,snapshot);
  expect((await reopened.readDevelop('version-2')).data.develop).toEqual(wb);
  expect((await reopened.processPreview(request(wb),input)).pixels).toEqual(new Uint8Array([200,109,95,255]));
  await expect(reopened.processPreview({...request(wb),expected_develop:{...wb,temperature_kelvin:6500}},input)).rejects.toThrow('recipe changed');
 }finally{await reopened?.close();await document?.close();await host.dispose();}
});

it('rejects unsupported recipe fields without silently dropping processing intent',async()=>{
 const apply=vi.fn(async()=>({data:{ok:true},events:[]}));
 const host={open:vi.fn(async()=>8),apply,close:vi.fn(async()=>true)} as unknown as EngineHost;
 const doc=await PhotoDocument.open(host);const calls=apply.mock.calls.length;
 const unsupported={...IDENTITY_DEVELOP,clarity:50};
 expect(()=>doc.setDevelop('version-2',unsupported)).toThrow('Unsupported');
 await expect(doc.processPreview(request(unsupported),new Uint8Array([1,2,3,4]))).rejects.toThrow('Unsupported');
 expect(apply).toHaveBeenCalledTimes(calls);await doc.close();
});

it('rejects out-of-range white balance fields before transport',async()=>{
 const apply=vi.fn(async()=>({data:{ok:true},events:[]}));
 const host={open:vi.fn(async()=>8),apply,close:vi.fn(async()=>true)} as unknown as EngineHost;
 const doc=await PhotoDocument.open(host);const calls=apply.mock.calls.length;
 for(const bad of [{...IDENTITY_DEVELOP,temperature_kelvin:1999},{...IDENTITY_DEVELOP,temperature_kelvin:40001},{...IDENTITY_DEVELOP,tint:1.5},{...IDENTITY_DEVELOP,tint:-2}]){
  expect(()=>doc.setDevelop('version-2',bad as PhotoDevelopV1)).toThrow('Unsupported');
  await expect(doc.processPreview(request(bad as PhotoDevelopV1),new Uint8Array([1,2,3,4]))).rejects.toThrow('Unsupported');
 }
 expect(apply).toHaveBeenCalledTimes(calls);await doc.close();
});

it('rejects an exact-length non-ASCII base64 response through the shared decoder',async()=>{
 const apply=vi.fn(async(_id:number,command:{op:string;payload?:unknown})=>{
  if(command.op==='new')return{data:{ok:true},events:[]};
  return{data:{...request(IDENTITY_DEVELOP),develop:IDENTITY_DEVELOP,row_stride:4,pixels_b64:'ĀĀĀĀĀĀ=='},events:[]};
 });
 const host={open:vi.fn(async()=>8),apply,close:vi.fn(async()=>true)} as unknown as EngineHost;
 const doc=await PhotoDocument.open(host);
 await expect(doc.processPreview(request(IDENTITY_DEVELOP),new Uint8Array([1,2,3,4]))).rejects.toThrow();
 await doc.close();
});
