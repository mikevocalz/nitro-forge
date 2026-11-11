import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives bounded expressions through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:1,duration_s:1});
  const layer=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[255,0,0,255]},'mover')).data.layer_id;
  const other=(await doc.addShapeLayer({kind:'rect',x:4,y:0,w:1,h:1,fill:[0,255,0,255]},'driver')).data.layer_id;
  await doc.updateLayer(other,{opacity:0.5});
  // tx = layer(other).opacity * time * 8 → 1 at t=0.25, 4 at t=1.
  await doc.setExpression(layer,'tx','layer('+other+').opacity * time * 8');
  // sx = fps (30), rotation = frame (floor(time*fps)).
  await doc.setExpression(layer,'sx','fps');
  await doc.setExpression(layer,'rotation','frame');
  const ev=await doc.evaluate(1);
  const moved=ev.data.layers.find(l=>l.id===layer)!;
  expect(moved.transform.tx).toBeCloseTo(4,9);
  expect(moved.transform.sx).toBeCloseTo(30,9);
  expect(moved.transform.rotation).toBeCloseTo(30,9);
  expect(moved.expressions).toBeUndefined(); // cleared in evaluated output like curves
  const described=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(described.expressions).toEqual([
   {property:'tx',source:'layer('+other+').opacity * time * 8'},
   {property:'sx',source:'fps'},
   {property:'rotation',source:'frame'},
  ]);
  // Mutual exclusion: keys on tx clear the tx expression atomically.
  await doc.setPropertyKeys(layer,'tx',[
   {time:0,value:0,interpolation:'linear',in_handle:null,out_handle:null},
   {time:1,value:2,interpolation:'linear',in_handle:null,out_handle:null},
  ]);
  const after=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(after.expressions!.map(e=>e.property)).toEqual(['sx','rotation']);
  expect(after.curves!.some(c=>c.property==='tx')).toBe(true);
  // Real pixels: opacity ternary hides the layer after t=0.5. sx=30 makes
  // the mover cover the canvas whenever visible, so row-alpha is a clean
  // signal; `other` (opacity 0.5) stays visible at x=4 throughout.
  await doc.setExpression(layer,'opacity','time > 0.5 ? 0 : 1');
  const frame=async(t:number)=>Buffer.from((await doc.renderFrame(t)).data.pixels_b64!,'base64');
  const early=await frame(0.25);
  expect(Math.max(early[3],early[7],early[11],early[15])).toBeGreaterThan(0);
  const late=await frame(0.75);
  expect([3,7,11,15].every(i=>late[i]===0)).toBe(true);
  expect(late[19]).toBeGreaterThan(0);
  // Parse/cycle rejections are atomic and leave state untouched.
  const before=(await doc.describe()).data;
  await expect(doc.setExpression(layer,'tx','this.tx + 1')).rejects.toThrow();
  await expect(doc.setExpression(layer,'tx','random(1)')).rejects.toThrow();
  expect((await doc.describe()).data).toEqual(before);
  // Undo the opacity write, then the keys write — restoring the tx
  // expression and removing the tx curve in one atomic step; redo re-clears.
  await doc.undo();
  await doc.undo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.expressions!.map(e=>e.property)).toContain('tx');
  await doc.redo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.expressions!.map(e=>e.property)).not.toContain('tx');
 }finally{await doc?.close();await host.dispose();}
});
