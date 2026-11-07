import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives blend modes and layer clipping through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:3,height:1,duration_s:1});
  const base=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:2,h:1,fill:[255,0,0,255]},'base')).data.layer_id;
  const top=(await doc.addShapeLayer({kind:'rect',x:1,y:0,w:2,h:1,fill:[0,0,255,255]},'top')).data.layer_id;
  // Clipped to the sibling below: x2 falls outside the base alpha.
  await doc.setLayerClipped(top,true);
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,0,0,255,255,0,0,0,0]).toString('base64'));
  const state=(await doc.describe()).data;
  const described=state.layers.find(l=>l.id===top)!;
  expect(described.clipped).toBe(true);
  // Blend mode passes through to Prism: multiply of [0,0,255] over [255,0,0].
  await doc.setLayerBlend(top,'multiply');
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,0,0,0,255,0,0,0,0]).toString('base64'));
  expect((await doc.describe()).data.layers.find(l=>l.id===top)!.blend).toBe('multiply');
  // null clears to normal; the bottom layer cannot clip.
  await doc.setLayerBlend(top,null);
  await expect(doc.setLayerClipped(base,true)).rejects.toThrow();
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,0,0,255,255,0,0,0,0]).toString('base64'));
  // Undo restores the multiply then the clipped-only state; redo reapplies.
  await doc.undo();await doc.undo();
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,0,0,255,255,0,0,0,0]).toString('base64'));
  await doc.redo();await doc.redo();
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,0,0,255,255,0,0,0,0]).toString('base64'));
 }finally{await doc?.close();await host.dispose();}
});
