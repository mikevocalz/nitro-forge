import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument} from '../src/index';
it('drives real hatch CRUD, clipped pattern pixels, layer semantics and snapshot reopen through the CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const a=(await doc.addPoint(0,0)).data.point_id,b=(await doc.addPoint(4,0)).data.point_id;
  const c=(await doc.addPoint(4,4)).data.point_id,d=(await doc.addPoint(0,4)).data.point_id;
  const edges=[];
  for(const [p,q] of [[a,b],[b,c],[c,d],[d,a]] as const)edges.push((await doc.addSegment(p,q)).data.segment_id);
  // Open chains and unknown ids reject before any state change.
  await expect(doc.addHatch({boundary_ids:[edges[0]!,edges[1]!]},{pattern:'solid'})).rejects.toThrow();
  await expect(doc.addHatch({boundary_ids:[edges[0]!,9999]},{pattern:'solid'})).rejects.toThrow();
  // tolerance applies only to boundary_ids tracing, never explicit loops.
  await expect(doc.addHatch({loops:[[[0,0],[1,0],[0,1]]]},{tolerance:0.5})).rejects.toThrow();
  const solid=(await doc.addHatch({boundary_ids:edges},{pattern:'solid',color:[255,0,0,255]})).data.hatch_id;
  const px=async()=>{const r=await doc!.renderFrame({width:6,height:6,origin_x:0,origin_y:0,scale:1});return Buffer.from(r.data.pixels_b64!,'base64');};
  const filled=await px();
  const at=(buf:Buffer,x:number,y:number)=>[buf[(y*6+x)*4],buf[(y*6+x)*4+1],buf[(y*6+x)*4+2],buf[(y*6+x)*4+3]];
  expect(at(filled,2,2)).toEqual([255,0,0,255]);
  expect(at(filled,5,5)[3]).toBe(0);
  // Line pattern produces different real pixels; crosshatch/horizontal admit too.
  await doc.updateHatch(solid,{pattern:'ansi31',scale:1,width:0.5});
  const lined=await px();
  expect(lined.equals(filled)).toBe(false);
  expect(lined.some(v=>v!==0)).toBe(true);
  await doc.updateHatch(solid,{pattern:'crosshatch'});
  expect((await px()).some(v=>v!==0)).toBe(true);
  // Non-associative boundary: moving an entity does not move stored loops.
  const loopsBefore=(await doc.describe()).data.hatches?.[String(solid)]?.loops;
  await doc.updatePoint(a,{x:9});
  expect((await doc.describe()).data.hatches?.[String(solid)]?.loops).toEqual(loopsBefore);
  // Undo restores the point move; hatch ops have their own history entries.
  expect(await doc.undo()).toBe(true);
  // Hidden layer excludes the fill but not the boundary strokes.
  const layer=(await doc.addLayer('HatchLayer')).data.layer_id;
  await doc.updateLayer(layer,{visible:false});
  const onLayer=(await doc.addHatch({boundary_ids:edges},{pattern:'solid',color:[0,255,0,255],layer})).data.hatch_id;
  const hidden=await px();
  expect(at(hidden,2,2)).not.toEqual([0,255,0,255]);
  expect(hidden.some(v=>v!==0)).toBe(true);
  await doc.updateLayer(layer,{visible:true});
  expect(at(await px(),2,2)).toEqual([0,255,0,255]);
  // Locked layer rejects hatch edits until unlocked; removeLayer refuses refs.
  await doc.updateLayer(layer,{locked:true});
  await expect(doc.updateHatch(onLayer,{name:'x'})).rejects.toThrow();
  await expect(doc.removeHatch(onLayer)).rejects.toThrow();
  await expect(doc.removeLayer(layer)).rejects.toThrow();
  await doc.updateLayer(layer,{locked:false});
  // Snapshot reopen preserves hatches byte-identically and undo works after.
  const bytes=await doc.save();
  reopened=await DraftDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  const redescribed=(await reopened.describe()).data;
  expect(redescribed.hatches?.[String(solid)]?.pattern).toBe('crosshatch');
  expect(redescribed.hatches?.[String(solid)]?.layer).toBeUndefined();
  expect(redescribed.hatches?.[String(onLayer)]?.layer).toBe(layer);
  await reopened.removeHatch(onLayer);
  expect((await reopened.describe()).data.hatches?.[String(onLayer)]).toBeUndefined();
  expect(await reopened.undo()).toBe(true);
  expect((await reopened.describe()).data.hatches?.[String(onLayer)]?.layer).toBe(layer);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
