import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument} from '../src/index';
it('drives real layer CRUD, hidden exclusion, locked rejection and snapshot reopen through the CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const walls=(await doc.addLayer('Walls',{color:[255,0,0,255]})).data.layer_id;
  const notes=(await doc.addLayer('Notes')).data.layer_id;
  await expect(doc.addLayer('Walls')).rejects.toThrow();
  await expect(doc.updateLayer(0,{name:'Zero'})).rejects.toThrow();
  await expect(doc.removeLayer(0)).rejects.toThrow();
  const a=(await doc.addPoint(0,0)).data.point_id,b=(await doc.addPoint(3,0)).data.point_id;
  const c=(await doc.addPoint(0,3)).data.point_id,d=(await doc.addPoint(3,3)).data.point_id;
  const edges=[];
  for(const [p,q] of [[a,b],[b,d],[d,c],[c,a]] as const)edges.push((await doc.addSegment(p,q,{layer:walls})).data.segment_id);
  const described=(await doc.describe()).data;
  expect(described.layers?.[String(walls)]).toMatchObject({name:'Walls',visible:true,locked:false});
  expect(described.segments[String(edges[0]!)]?.layer).toBe(walls);
  // Hidden layer: no pixels, no profile, no midpoint snap.
  await doc.updateLayer(walls,{visible:false});
  const hiddenPixels=Buffer.from((await doc.renderFrame({width:3,height:1,origin_x:0,origin_y:0,scale:1})).data.pixels_b64!,'base64');
  expect(hiddenPixels.every(v=>v===0)).toBe(true);
  expect((await doc.findProfiles()).data.profiles).toHaveLength(0);
  await doc.setSnapSettings({grid:false,endpoint:false,projection:false,intersection:false,midpoint:true});
  expect((await doc.querySnap(1.5,0.1,0.2)).data.candidate).toBeNull();
  await doc.updateLayer(walls,{visible:true});
  const snap=(await doc.querySnap(1.5,0.1,0.2)).data;
  expect(snap.candidate).toMatchObject({kind:'midpoint',sources:[edges[0]!]});
  expect((await doc.findProfiles()).data.profiles).toHaveLength(1);
  // Locked layer rejects entity edits until unlocked; assignment stays allowed.
  await doc.updateLayer(walls,{locked:true});
  await expect(doc.updateSegment(edges[0]!,{name:'x'})).rejects.toThrow();
  await expect(doc.removeSegment(edges[0]!)).rejects.toThrow();
  await expect(doc.updatePoint(a,{x:9})).rejects.toThrow();
  const spare=(await doc.addSegment(a,b,{layer:walls})).data.segment_id;
  await expect(doc.updateSegment(spare,{visible:false})).rejects.toThrow();
  await expect(doc.removeLayer(walls)).rejects.toThrow();
  await doc.updateLayer(walls,{locked:false});
  await doc.updateSegment(edges[0]!,{name:'renamed'});
  // Undo/redo across layer ops and snapshot reopen preserve the model.
  const bytes=await doc.save();
  reopened=await DraftDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  const redescribed=(await reopened.describe()).data;
  expect(redescribed.layers?.[String(notes)]?.name).toBe('Notes');
  expect(redescribed.segments[String(edges[0]!)]).toMatchObject({name:'renamed',layer:walls});
  await reopened.updateLayer(walls,{visible:false});
  expect((await reopened.findProfiles()).data.profiles).toHaveLength(0);
  await reopened.removeSegment(spare);
  await expect(reopened.removeLayer(walls)).rejects.toThrow();
  for(const id of edges)await reopened.removeSegment(id);
  await reopened.removeLayer(walls);
  expect((await reopened.describe()).data.layers?.[String(walls)]).toBeUndefined();
  expect(await reopened.undo()).toBe(true);
  expect((await reopened.describe()).data.layers?.[String(walls)]?.name).toBe('Walls');
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
