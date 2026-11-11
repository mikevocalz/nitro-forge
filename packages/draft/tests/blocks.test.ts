import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument} from '../src/index';
it('drives real block definitions, transformed inserts, snaps and snapshot reopen through the CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const block=(await doc.addBlock('part',{base_x:0,base_y:0})).data.block_id;
  const a=(await doc.addPoint(0,0)).data.point_id,b=(await doc.addPoint(4,0)).data.point_id;
  const seg=(await doc.addSegment(a,b,{block,color:[0,0,0,255],width:0.5})).data.segment_id;
  // Definition geometry draws and snaps nowhere until an insert exists.
  const blank=await doc.renderFrame({width:8,height:8,origin_x:0,origin_y:0,scale:1});
  expect(Buffer.from(blank.data.pixels_b64!,'base64').every(v=>v===0)).toBe(true);
  const ins=(await doc.addInsert({block,x:10,y:20,scale:2})).data.insert_id;
  const snap=await doc.querySnap(18.3,20.3,0.5);
  expect(snap.data.candidate).toMatchObject({kind:'endpoint',x:18,y:20});
  expect(snap.data.candidate!.sources).toContain(ins);
  expect(snap.data.candidate!.sources).toContain(seg);
  // Real pixels: the scaled instance renders; members never draw directly.
  const r=await doc.renderFrame({width:24,height:26,origin_x:0,origin_y:0,scale:1});
  const rgba=Buffer.from(r.data.pixels_b64!,'base64');
  let dark=0;for(let y=18;y<23;y++)for(let x=8;x<20;x++){const i=(y*24+x)*4;if(rgba[i]!<200&&rgba[i+3]!>0)dark++}
  expect(dark).toBeGreaterThan(0);
  const described=(await doc.describe()).data;
  expect(described.blocks?.[String(block)]?.name).toBe('part');
  expect(described.inserts?.[String(ins)]?.scale).toBe(2);
  expect(described.segments?.[String(seg)]?.block).toBe(block);
  const evaluated=(await doc.evaluate()).data;
  expect(evaluated.inserts?.[String(ins)]?.x).toBe(10);
  // Guards: unknown refs, bad transforms, cycles and removal references reject.
  await expect(doc.addInsert({block:9999,x:0,y:0})).rejects.toThrow();
  await expect(doc.addInsert({block,x:0,y:0,scale:-1})).rejects.toThrow();
  await expect(doc.removeBlock(block)).rejects.toThrow();
  await expect(doc.addInsert({block,parent:block,x:0,y:0})).rejects.toThrow();
  await doc.updateInsert(ins,{locked:true});
  await expect(doc.updateInsert(ins,{scale:3})).rejects.toThrow();
  await expect(doc.removeInsert(ins)).rejects.toThrow();
  await doc.updateInsert(ins,{locked:false});
  // Command grammar routes BLOCK/INSERT through the same ops.
  const gb=(await doc.executeCommand('BLOCK NEW gadget')).data.result as {block_id:number};
  const gi=(await doc.executeCommand(`INSERT ${gb.block_id} 30 30`)).data.result as {insert_id:number};
  await doc.executeCommand(`DELETE INSERT ${gi.insert_id}`);
  await doc.executeCommand(`DELETE BLOCK ${gb.block_id}`);
  // One undo removes a whole insert; snapshot reopen preserves blocks.
  const bytes=await doc.save();
  reopened=await DraftDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect((await reopened.describe()).data.inserts?.[String(ins)]?.block).toBe(block);
  await reopened.removeInsert(ins);
  expect((await reopened.describe()).data.inserts?.[String(ins)]).toBeUndefined();
  expect(await reopened.undo()).toBe(true);
  expect((await reopened.describe()).data.inserts?.[String(ins)]?.block).toBe(block);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
