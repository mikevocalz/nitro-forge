import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives 3D transforms, curves and projection eval through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:8,duration_s:2});
  const layer=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:4,h:4,fill:[255,0,0,255]},'cube')).data.layer_id;
  const flat=async(t:number)=>Buffer.from((await doc.renderFrame(t)).data.pixels_b64!,'base64');
  const baseline=await flat(0);
  // 2D-only layer carries no transform3d and no projection.
  const plain=(await doc.evaluate(0)).data.layers.find(l=>l.id===layer)!;
  expect(plain.transform3d).toBeUndefined();
  expect(plain.projected_transform).toBeUndefined();
  await doc.setLayer3D(layer,{rx:30,ry:45,z:5});
  const stored=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(stored.transform3d).toEqual({rx:30,ry:45,z:5});
  // rx curve animates; evaluate reports evaluated values + orthographic
  // projected_transform (a'=cos(ry), c'=sin(ry)·sin(rx), d'=cos(rx)).
  await doc.setPropertyKeys(layer,'rx',[
   {time:0,value:0,interpolation:'linear',in_handle:null,out_handle:null},
   {time:2,value:90,interpolation:'linear',in_handle:null,out_handle:null},
  ]);
  const mid=(await doc.evaluate(1)).data.layers.find(l=>l.id===layer)!;
  expect(mid.transform3d).toEqual({rx:45,ry:45,z:5});
  expect(mid.curves).toEqual([]);
  const p=mid.projected_transform!;
  const sry=Math.sin(Math.PI/4),cry=Math.cos(Math.PI/4),srx=cry,crx=cry;
  expect(p.a).toBeCloseTo(cry,9);
  expect(p.b).toBeCloseTo(0,9);
  expect(p.c).toBeCloseTo(sry*srx,9);
  expect(p.d).toBeCloseTo(crx,9);
  // z never enters the orthographic coefficients.
  await doc.setLayer3D(layer,{rx:45,ry:45,z:-9000});
  const deep=(await doc.evaluate(1)).data.layers.find(l=>l.id===layer)!;
  expect(deep.projected_transform).toEqual(p);
  // Documented G1 render no-op: nonzero rx/ry/z change no pixels — the
  // frame with full 3D state is byte-identical to the 2D baseline.
  expect(await flat(0)).toEqual(baseline);
  expect(await flat(1)).toEqual(baseline);
  // Clearing removes transform3d and the rx curve atomically.
  await doc.setLayer3D(layer,null);
  const cleared=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(cleared.transform3d).toBeUndefined();
  expect(cleared.curves.find(c=>c.property==='rx')).toBeUndefined();
  // Undo restores transform3d + curve; redo re-clears.
  await doc.undo();
  const undone=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(undone.transform3d?.rx).toBe(45);
  expect(undone.curves.some(c=>c.property==='rx')).toBe(true);
  await doc.redo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.transform3d).toBeUndefined();
  // Bounds/atomic rejects through the facade.
  await expect(doc.setLayer3D(layer,{rx:1e7+1,ry:0,z:0})).rejects.toThrow();
  await doc.setLayer3D(layer,{rx:0,ry:0,z:0});
  await expect(doc.setPropertyKeys(layer,'rx',[{time:0,value:1e7+1,interpolation:'hold',in_handle:null,out_handle:null}])).rejects.toThrow();
  // Snapshot round-trip preserves 3D state.
  const bytes=await doc.save();
  const reopened=await MotionDocument.openSnapshot(host,bytes);
  try{
   const r=(await reopened.describe()).data.layers.find(l=>l.id===layer)!;
   expect(r.transform3d).toEqual({rx:0,ry:0,z:0});
  }finally{await reopened.close();}
 }finally{await doc?.close();await host.dispose();}
});
