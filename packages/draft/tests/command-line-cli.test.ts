import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument,bindDraftingCommandLine} from '../src/index';
it('runs the command binding through real CLI geometry, pixels, history and owned reopen',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);const entries:unknown[]=[];
  const binding=bindDraftingCommandLine(doc,{history:[],busy:false,isCurrent:()=>true,perform:async action=>{await action();},onInput:()=>{},onCancel:()=>{},recordHistory:entry=>entries.push(entry)});
  await binding.onExecute('LINE 0 0.5 3 0.5');expect(entries[0]).toMatchObject({kind:'result'});
  const created=await doc.save();expect((await doc.renderFrame({width:3,height:1,origin_x:0,origin_y:0,scale:1})).data.pixels_b64).toBe(Buffer.from([0,0,0,255,0,0,0,255,0,0,0,255]).toString('base64'));
  await doc.undo();expect(Object.keys((await doc.describe()).data.points)).toHaveLength(0);await doc.redo();expect(await doc.save()).toEqual(created);
  await expect(binding.onExecute('SPHERE 0 0 1')).rejects.toThrow();expect(entries[1]).toMatchObject({kind:'error'});expect(await doc.save()).toEqual(created);
  await doc.setSnapSettings({grid:false,endpoint:false,midpoint:false,projection:false,intersection:false,ortho:true});const snap=await doc.executeCommand('SNAP 2 2 2 0 0');expect(snap.data.result).toMatchObject({candidate:{kind:'ortho',x:2,y:0,angle_degrees:0}});
  const bytes=await doc.save();reopened=await DraftDocument.openSnapshot(host,bytes);expect(await reopened.save()).toEqual(bytes);expect((await reopened.describe()).data.snaps.ortho).toBe(true);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
it('creates, moves and reopens actual circular geometry through the CLI command owner',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);const empty=await doc.save();
  const binding=bindDraftingCommandLine(doc,{history:[],busy:false,isCurrent:()=>true,perform:async action=>{await action();},onInput:()=>{},onCancel:()=>{},recordHistory:()=>{}});
  await binding.onExecute('CIRCLE 2.5 2.5 1.5');const circle=await doc.save();
  expect((await doc.describe()).data.circles['2']).toMatchObject({center:1,radius:1.5});
  const rgba=Buffer.from((await doc.renderFrame({width:5,height:5,origin_x:0,origin_y:0,scale:1})).data.pixels_b64!,'base64');
  expect(rgba[3]).toBe(0);expect(rgba[(1*5+2)*4+3]).toBeGreaterThan(rgba[(2*5+2)*4+3]!);
  await doc.undo();expect(await doc.save()).toEqual(empty);await doc.redo();expect(await doc.save()).toEqual(circle);
  await expect(binding.onExecute('ARC 0 0 1 0 0')).rejects.toThrow();expect(await doc.save()).toEqual(circle);
  await binding.onExecute('ARC 2.5 2.5 1 0 -90');await binding.onExecute('MOVE 1 3 3');
  const described=(await doc.describe()).data;expect(described.points['1']).toMatchObject({x:3,y:3});expect(described.arcs['4']).toMatchObject({center:3,sweep_deg:-90});
  expect((await doc.solve()).data.scope).toBe('point_coordinates');
  const bytes=await doc.save();reopened=await DraftDocument.openSnapshot(host,bytes);expect(await reopened.save()).toEqual(bytes);
  await binding.onExecute('DELETE CIRCLE 2');expect((await doc.describe()).data.points['1']).toBeDefined();
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
it('traces closed-loop profiles through the real CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const pt=async(x:number,y:number)=>(await doc!.addPoint(x,y)).data.point_id;
  const seg=async(a:number,b:number)=>(await doc!.addSegment(a,b)).data.segment_id;
  const [a,b,c,d]=[await pt(0,0),await pt(4,0),await pt(4,3),await pt(0,3)];
  const edges=[await seg(a,b),await seg(b,c),await seg(c,d),await seg(d,a)];
  const first=await doc.findProfiles();
  expect(first.data.profiles).toHaveLength(1);
  expect(first.data.profiles[0]).toMatchObject({area:12,centroid:{x:2,y:1.5},bounds:{min_x:0,min_y:0,max_x:4,max_y:3}});
  expect(first.data.profiles[0]!.loops.flat().sort()).toEqual([...edges].sort());
  // A lone segment between near-coincident points must not emit a phantom profile.
  const [p,q]=[await pt(100,100),await pt(100.0000005,100)];
  await seg(p,q);
  expect((await doc.findProfiles()).data.profiles).toHaveLength(1);
  // Hidden geometry is excluded: opening the rectangle drops the profile.
  await doc.updateSegment(edges[2]!,{visible:false});
  expect((await doc.findProfiles()).data.profiles).toHaveLength(0);
  await doc.updateSegment(edges[2]!,{visible:true});
  const restored=await doc.findProfiles();
  expect(restored.data.profiles).toHaveLength(1);
  expect(restored.data.profiles[0]!.area).toBeCloseTo(12,9);
 }finally{await doc?.close();await host.dispose();}
});
it('runs LAYER, HATCH and DIM grammar commands through the real CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const layer=(await doc.executeCommand('LAYER NEW Walls')).data.result as {layer_id:number};
  expect((await doc.describe()).data.layers?.[String(layer.layer_id)]).toMatchObject({name:'Walls',visible:true});
  await doc.executeCommand(`LAYER VISIBLE ${layer.layer_id} off`);
  expect((await doc.describe()).data.layers?.[String(layer.layer_id)]).toMatchObject({visible:false});
  await doc.undo();expect((await doc.describe()).data.layers?.[String(layer.layer_id)]).toMatchObject({visible:true});
  const pt=async(x:number,y:number)=>(await doc!.addPoint(x,y)).data.point_id;
  const seg=async(a:number,b:number)=>(await doc!.addSegment(a,b)).data.segment_id;
  const [a,b,c,d]=[await pt(0,0),await pt(4,0),await pt(4,3),await pt(0,3)];
  const edges=[await seg(a,b),await seg(b,c),await seg(c,d),await seg(d,a)];
  const hatch=(await doc.executeCommand(`HATCH ansi31 ${edges.join(' ')}`)).data.result as {hatch_id:number};
  expect((await doc.describe()).data.hatches?.[String(hatch.hatch_id)]).toMatchObject({pattern:'ansi31'});
  const dim=(await doc.executeCommand(`DIM LINEAR ${a} ${b} x`)).data.result as {dimension_id:number};
  const ev=await doc.evaluate();
  expect(ev.data.dimensions?.[String(dim.dimension_id)]).toMatchObject({status:'linked',measured:{value:4}});
  await doc.executeCommand(`DELETE DIMENSION ${dim.dimension_id}`);
  expect((await doc.describe()).data.dimensions?.[String(dim.dimension_id)]).toBeUndefined();
  await expect(doc.executeCommand('BLOCK 1 2')).rejects.toThrow();
  await expect(doc.executeCommand('DIM LINEAR 1 2 z')).rejects.toThrow();
 }finally{await doc?.close();await host.dispose();}
});
