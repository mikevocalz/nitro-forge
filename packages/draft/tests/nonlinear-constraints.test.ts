import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument} from '../src/index';

const dist=(s:{points:Record<string,{x:number;y:number}>},a:number,b:number)=>{
 const pa=s.points[String(a)]!,pb=s.points[String(b)]!;
 return Math.hypot(pa.x-pb.x,pa.y-pb.y);
};

it('solves a nonlinear distance constraint into real moved geometry, snapshot and undo',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const a=(await doc.addPoint(0,0)).data.point_id;
  const b=(await doc.addPoint(3,4)).data.point_id; // authored distance 5
  const fixed=(await doc.addPoint(50,50)).data.point_id;
  await doc.addConstraint({kind:'fixed',point:fixed,x:50,y:50});
  await doc.addConstraint({kind:'distance',a,b,value:10});
  const report=await doc.solve();
  expect(report.data.status).toBe('underconstrained'); // free DOF remain; consistent
  expect(report.data.nonlinear?.status).toBe('solved');
  expect(report.data.applied).toBe(true);
  expect(report.data.unsatisfied_constraints).toEqual([]);
  const after=(await doc.describe()).data;
  expect(Math.abs(dist(after,a,b)-10)).toBeLessThan(1e-5);
  // Deterministic re-solve stays solved and does not error.
  const again=await doc.solve();
  expect(again.data.nonlinear?.status).toBe('solved');
  expect(Math.abs(dist((await doc.describe()).data,a,b)-10)).toBeLessThan(1e-5);
  // Snapshot round-trip preserves the nonlinear constraint (schema-2 wrapper).
  const bytes=await doc.save();
  reopened=await DraftDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect(Object.keys((await reopened.describe()).data.constraints)).toHaveLength(2);
  // Undo restores the authored geometry exactly.
  await doc.undo();
  const undone=(await doc.describe()).data;
  expect(dist(undone,a,b)).toBeCloseTo(5,9);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});

it('rejects invalid nonlinear definitions atomically and solves radius on a real circle',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const c=(await doc.addPoint(10,10)).data.point_id;
  const circle=(await doc.addCircle(c,2)).data.circle_id;
  const segA=(await doc.addPoint(0,0)).data.point_id;
  const segB=(await doc.addPoint(4,0)).data.point_id;
  const seg=(await doc.addSegment(segA,segB)).data.segment_id;
  const before=await doc.save();
  // Wrong entity kind for a segment-only kind must reject before mutation.
  await expect(doc.addConstraint({kind:'perpendicular',a:seg,b:circle})).rejects.toThrow();
  // Self-reference and non-finite values reject the same way.
  await expect(doc.addConstraint({kind:'parallel',a:seg,b:seg})).rejects.toThrow();
  await expect(doc.addConstraint({kind:'radius',entity:circle,value:Number.NaN})).rejects.toThrow();
  await expect(doc.addConstraint({kind:'angle',vertex:segA,first:segB,second:seg,degrees:90})).rejects.toThrow();
  expect(await doc.save()).toEqual(before);
  // Radius constraint drives the real circle radius.
  await doc.addConstraint({kind:'radius',entity:circle,value:5});
  const report=await doc.solve();
  expect(report.data.nonlinear?.status).toBe('solved');
  const described=(await doc.describe()).data;
  expect(Math.abs(described.circles[String(circle)]!.radius-5)).toBeLessThan(1e-5);
 }finally{await doc?.close();await host.dispose();}
});

it('solves a parallel constraint into rotated real geometry',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const a=(await doc.addPoint(0,0)).data.point_id;
  const b=(await doc.addPoint(4,0)).data.point_id;
  const c=(await doc.addPoint(0,1)).data.point_id;
  const d=(await doc.addPoint(5,3)).data.point_id; // deliberately not parallel
  const ab=(await doc.addSegment(a,b)).data.segment_id;
  const cd=(await doc.addSegment(c,d)).data.segment_id;
  await doc.addConstraint({kind:'parallel',a:ab,b:cd});
  const report=await doc.solve();
  expect(report.data.nonlinear?.status).toBe('solved');
  const after=(await doc.describe()).data;
  const pab=after.segments[String(ab)]!,pcd=after.segments[String(cd)]!;
  const va=[after.points[String(pab.a)]!.x-after.points[String(pab.b)]!.x,after.points[String(pab.a)]!.y-after.points[String(pab.b)]!.y];
  const vc=[after.points[String(pcd.a)]!.x-after.points[String(pcd.b)]!.x,after.points[String(pcd.a)]!.y-after.points[String(pcd.b)]!.y];
  const cross=Math.abs(va[0]! * vc[1]! - va[1]! * vc[0]!);
  const la=Math.hypot(va[0]!,va[1]!),lc=Math.hypot(vc[0]!,vc[1]!);
  expect(cross/(la*lc)).toBeLessThan(1e-5);
 }finally{await doc?.close();await host.dispose();}
});
