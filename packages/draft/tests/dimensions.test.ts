import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument} from '../src/index';
it('drives real associative dimension CRUD, recompute, orphaning and snapshot reopen through the CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const a=(await doc.addPoint(0,0)).data.point_id,b=(await doc.addPoint(4,0)).data.point_id;
  const c=(await doc.addPoint(4,3)).data.point_id;
  // Invalid definitions reject before any state change.
  await expect(doc.addDimension({kind:'linear',points:[a,b]})).rejects.toThrow();
  await expect(doc.addDimension({kind:'aligned',points:[a,b],axis:'x'})).rejects.toThrow();
  await expect(doc.addDimension({kind:'radial'})).rejects.toThrow();
  await expect(doc.addDimension({kind:'linear',points:[a,9999],axis:'x'})).rejects.toThrow();
  const dim=(await doc.addDimension({kind:'linear',points:[a,b],axis:'x',color:[255,0,0,255]})).data.dimension_id;
  let ev=(await doc.evaluate()).data;
  expect(ev.dimensions?.[String(dim)]).toMatchObject({kind:'linear',status:'linked'});
  expect(ev.dimensions?.[String(dim)]?.measured?.value).toBe(4);
  expect(ev.dimensions?.[String(dim)]?.measured?.lines.length).toBeGreaterThanOrEqual(3);
  // Associative recompute: moving a referenced point changes the measurement.
  await doc.updatePoint(b,{x:7});
  ev=(await doc.evaluate()).data;
  expect(ev.dimensions?.[String(dim)]?.measured?.value).toBe(7);
  // Aligned and angular kinds measure through the same read path.
  const aligned=(await doc.addDimension({kind:'aligned',points:[a,c]})).data.dimension_id;
  const angular=(await doc.addDimension({kind:'angular',points:[a,b,c]})).data.dimension_id;
  ev=(await doc.evaluate()).data;
  expect(ev.dimensions?.[String(aligned)]?.measured?.value).toBeCloseTo(Math.hypot(4,3),9);
  expect(ev.dimensions?.[String(angular)]?.measured?.value).toBeCloseTo(Math.acos(0.8)*180/Math.PI,9);
  // Radial/diameter measure circle and arc entities.
  const center=(await doc.addPoint(20,0)).data.point_id;
  const circle=(await doc.addCircle(center,3)).data.circle_id;
  const arc=(await doc.addArc(center,3,90,90)).data.arc_id;
  const radial=(await doc.addDimension({kind:'radial',entity:circle})).data.dimension_id;
  const dia=(await doc.addDimension({kind:'diameter',entity:arc})).data.dimension_id;
  ev=(await doc.evaluate()).data;
  expect(ev.dimensions?.[String(radial)]?.measured?.value).toBe(3);
  expect(ev.dimensions?.[String(dia)]?.measured?.value).toBe(6);
  // Real stroked pixels with no segments on layer 0 besides authored points.
  const px=async()=>Buffer.from((await doc!.renderFrame({width:24,height:4,origin_x:0,origin_y:0,scale:1})).data.pixels_b64!,'base64');
  expect((await px()).some(v=>v!==0)).toBe(true);
  // Orphaning: deleting a referenced point clears measured geometry.
  await doc.removePoint(a);
  ev=(await doc.evaluate()).data;
  const orphaned=ev.dimensions?.[String(dim)];
  expect(orphaned).toMatchObject({status:'orphaned',points:[a,b]});
  expect(orphaned?.measured).toBeNull();
  // Style edits stay allowed on orphans; reference edits must resolve.
  await doc.updateDimension(dim,{name:'Renamed'});
  await expect(doc.updateDimension(dim,{points:[a,b]})).rejects.toThrow();
  const c2=(await doc.addPoint(1,1)).data.point_id,d2=(await doc.addPoint(1,6)).data.point_id;
  await doc.updateDimension(dim,{points:[c2,d2],axis:'y',name:'Relinked'});
  ev=(await doc.evaluate()).data;
  expect(ev.dimensions?.[String(dim)]).toMatchObject({status:'linked',name:'Relinked'});
  expect(ev.dimensions?.[String(dim)]?.measured?.value).toBe(5);
  // Locked dimension rejects edits until unlocked; undo restores.
  await doc.updateDimension(dim,{locked:true});
  await expect(doc.updateDimension(dim,{name:'x'})).rejects.toThrow();
  await expect(doc.removeDimension(dim)).rejects.toThrow();
  await doc.updateDimension(dim,{locked:false});
  // Entity deletion orphans radial references identically.
  await doc.removeCircle(circle);
  ev=(await doc.evaluate()).data;
  expect(ev.dimensions?.[String(radial)]?.status).toBe('orphaned');
  // Snapshot reopen preserves dimensions and derived status byte-identically.
  const bytes=await doc.save();
  reopened=await DraftDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  const redescribed=(await reopened.describe()).data;
  expect(redescribed.dimensions?.[String(dim)]).toMatchObject({kind:'linear',axis:'y',name:'Relinked'});
  expect(redescribed.dimensions?.[String(radial)]?.entity).toBe(circle);
  const rev=(await reopened.evaluate()).data;
  expect(rev.dimensions?.[String(radial)]?.status).toBe('orphaned');
  expect(rev.dimensions?.[String(dim)]?.status).toBe('linked');
  await reopened.removeDimension(dia);
  expect((await reopened.describe()).data.dimensions?.[String(dia)]).toBeUndefined();
  expect(await reopened.undo()).toBe(true);
  expect((await reopened.describe()).data.dimensions?.[String(dia)]?.entity).toBe(arc);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
