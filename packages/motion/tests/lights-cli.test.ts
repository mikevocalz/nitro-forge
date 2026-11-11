import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives light rigs and 3D lighting through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:8,duration_s:1});
  const layer=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:4,h:4,fill:[255,0,0,255]},'panel')).data.layer_id;
  const flat=async(t:number)=>Buffer.from((await doc.renderFrame(t)).data.pixels_b64!,'base64');
  const px=(buf:Buffer,x:number,y:number)=>[...buf.subarray((y*8+x)*4,(y*8+x)*4+4)];
  const baseline=await flat(0);
  expect(px(baseline,0,0)).toEqual([255,0,0,255]);
  // Identity-oriented 3D layer renders identically unlit.
  await doc.setLayer3D(layer,{rx:0,ry:0,z:0});
  expect(await flat(0)).toEqual(baseline);
  // Full-white ambient at intensity 1 is the identity factor.
  await doc.setLights([{type:'ambient',color:[1,1,1],intensity:1}]);
  expect(await flat(0)).toEqual(baseline);
  // Half-intensity ambient halves the lit channel: 255*0.5 -> 128.
  await doc.setLights([{type:'ambient',color:[1,1,1],intensity:0.5}]);
  const dim=await flat(0);
  expect(px(dim,0,0)).toEqual([128,0,0,255]);
  // Directional toward +Z (the flat normal) relights fully; from -Z the
  // RGB goes black while alpha coverage is preserved.
  await doc.setLights([{type:'directional',direction:[0,0,1],color:[1,1,1],intensity:1}]);
  expect(await flat(0)).toEqual(baseline);
  await doc.setLights([{type:'directional',direction:[0,0,-1],color:[1,1,1],intensity:1}]);
  const dark=await flat(0);
  expect(px(dark,0,0)).toEqual([0,0,0,255]);
  // describe exposes the root rig; clearing restores unlit pixels.
  expect((await doc.describe()).data.lights?.[0]?.type).toBe('directional');
  await doc.setLights(null);
  expect((await doc.describe()).data.lights).toEqual([]);
  expect(await flat(0)).toEqual(baseline);
  // Bounds/atomic rejects through the facade.
  await expect(doc.setLights(Array.from({length:9},()=>({type:'ambient' as const,color:[1,1,1] as [number,number,number],intensity:0.1})))).rejects.toThrow();
  await expect(doc.setLights([{type:'ambient',color:[1,1],intensity:1} as never])).rejects.toThrow();
  // Comp-scoped rig + snapshot round-trip.
  const comp=(await doc.addComposition({width:8,height:8})).data.comp_id;
  const inner=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:2,h:2,fill:[0,255,0,255]},'inner',comp)).data.layer_id;
  await doc.setLayer3D(inner,{rx:0,ry:0,z:0});
  await doc.addCompLayer(comp,'inst');
  await doc.setLights([{type:'ambient',color:[1,1,1],intensity:0.5}],comp);
  const compState=(await doc.describe()).data.compositions[String(comp)];
  expect(compState?.lights?.[0]?.type).toBe('ambient');
  const lit=await flat(0);
  expect(px(lit,0,0)).not.toEqual(px(baseline,0,0));
  const bytes=await doc.save();
  const reopened=await MotionDocument.openSnapshot(host,bytes);
  try{
   const r=(await reopened.describe()).data;
   expect(r.lights).toEqual([]);
   expect(r.compositions[String(comp)]?.lights?.[0]?.type).toBe('ambient');
  }finally{await reopened.close();}
 }finally{await doc?.close();await host.dispose();}
});
