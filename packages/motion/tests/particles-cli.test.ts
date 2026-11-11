import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives deterministic particle emitters through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:8,duration_s:4});
  const layer=(await doc.addParticlesLayer('fx')).data.layer_id;
  const emitter={
   seed:7,rate:20,lifetime_s:1.0,angle_deg:-90,spread_deg:0,speed:0,
   sprite:{kind:'shape' as const,shape:'rect' as const,width:1,height:1,fill:[255,0,0,255] as [number,number,number,number]},
   spawn:{x:2,y:2,w:1,h:1},fade:0,
  };
  await doc.setParticleEmitter(layer,emitter);
  const frame=async(t:number)=>Buffer.from((await doc.renderFrame(t)).data.pixels_b64!,'base64');
  // Deterministic: identical times give byte-identical frames, and seeking
  // back reproduces the earlier frame exactly (no sim state).
  const a=await frame(0.5),a2=await frame(0.5),b=await frame(1.5);
  expect(a.equals(a2)).toBe(true);
  expect(a.equals(b)).toBe(false);
  // Spawn rect [2,3)x[2,3) with speed 0 stacks sprites on pixel (2,2).
  expect(a[2*8*4+2*4+3]).toBeGreaterThan(0);
  // describe/evaluate expose the emitter spec on the particles layer.
  const described=(await doc.describe()).data;
  const stored=described.layers.find(l=>l.id===layer)!;
  expect(stored.kind).toBe('particles');
  expect(stored.emitter?.seed).toBe(7);
  expect(stored.emitter?.rate).toBe(20);
  const ev=await doc.evaluate(0.5);
  expect(ev.data.layers.find(l=>l.id===layer)!.emitter?.sprite.kind).toBe('shape');
  // Bounds reject atomically: rate*lifetime over 511, emitter on shape layer.
  const shape=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[0,255,0,255]},'s')).data.layer_id;
  await expect(doc.setParticleEmitter(shape,emitter)).rejects.toThrow();
  await expect(doc.setParticleEmitter(layer,{...emitter,rate:600})).rejects.toThrow();
  // Clearing leaves an empty particles layer that renders nothing.
  await doc.setParticleEmitter(layer,null);
  const cleared=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(cleared.kind).toBe('particles');
  expect(cleared.emitter).toBeUndefined();
  // The shape layer added above still renders; the particle field is gone.
  const afterClear=await frame(0.5);
  expect(afterClear[2*8*4+2*4+3]).toBe(0);
  // Undo restores the emitter, redo re-clears.
  await doc.undo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.emitter?.seed).toBe(7);
  await doc.redo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.emitter).toBeUndefined();
 }finally{await doc?.close();await host.dispose();}
});
