import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives media layer references through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:8,duration_s:2});
  const layer=(await doc.addMediaLayer({source_id:'host://clip/7',in_point:2.5},'footage')).data.layer_id;
  const stored=(await doc.describe()).data.layers.find(l=>l.id===layer)!;
  expect(stored.kind).toBe('media');
  expect(stored.media).toEqual({source_id:'host://clip/7',in_point:2.5});
  // evaluate exposes the stored spec; schema stays 2.
  const ev=(await doc.evaluate(0)).data.layers.find(l=>l.id===layer)!;
  expect(ev.media?.source_id).toBe('host://clip/7');
  expect((await doc.describe()).data.schema).toBe(2);
  // Honest render: a media-only frame is fully transparent — no pixels are
  // faked while the P03 transport contract is pending.
  const pixels=Buffer.from((await doc.renderFrame(0)).data.pixels_b64!,'base64');
  expect(pixels.every(b=>b===0)).toBe(true);
  // Shape sibling composites normally alongside the transparent media layer.
  const shape=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:4,h:4,fill:[255,0,0,255]})).data.layer_id;
  const mixed=Buffer.from((await doc.renderFrame(0)).data.pixels_b64!,'base64');
  expect(mixed.some(b=>b!==0)).toBe(true);
  // setLayerMedia replaces and clears; null leaves an empty media layer.
  await doc.setLayerMedia(layer,{source_id:'other',in_point:0});
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.media?.source_id).toBe('other');
  await doc.setLayerMedia(layer,null);
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.media).toBeUndefined();
  // Bounds and kind exclusivity reject atomically through the facade.
  await expect(doc.setLayerMedia(layer,{source_id:'',in_point:0})).rejects.toThrow();
  await expect(doc.setLayerMedia(layer,{source_id:'x'.repeat(513),in_point:0})).rejects.toThrow();
  await expect(doc.setLayerMedia(layer,{source_id:'ok',in_point:-1})).rejects.toThrow();
  await expect(doc.setLayerMedia(shape,{source_id:'ok',in_point:0})).rejects.toThrow();
  await expect(doc.addMediaLayer({source_id:'ok',in_point:0,codec:'h264'} as never)).rejects.toThrow();
  // Undo restores the cleared spec state; snapshot round-trips kind/media.
  await doc.undo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.media?.source_id).toBe('other');
  const bytes=await doc.save();
  const reopened=await MotionDocument.openSnapshot(host,bytes);
  try{
   const restored=(await reopened.describe()).data.layers.find(l=>l.id===layer)!;
   expect(restored.kind).toBe('media');
   expect(restored.media?.source_id).toBe('other');
  }finally{await reopened.close();}
 }finally{await doc?.close();}
});
