import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives track mattes through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:4,height:1,duration_s:1});
  // Matte source raster: white, black, transparent, white@128.
  const asset=(await doc.addRasterAsset(4,1,new Uint8Array([
   255,255,255,255, 0,0,0,255, 0,0,0,0, 255,255,255,128]))).data.asset_id;
  const source=(await doc.addRasterLayer(asset,'mask')).data.layer_id;
  const target=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:4,h:1,fill:[0,0,255,255]},'target')).data.layer_id;
  const frame=async()=>Buffer.from((await doc.renderFrame(0)).data.pixels_b64!,'base64');
  // alpha mode: opaque pixels matte fully, transparent hides the target,
  // the half-alpha pixel composites to alpha 192.
  await doc.setLayerMatte(target,{source_layer:source,mode:'alpha'});
  const alpha=await frame();
  expect([...alpha.subarray(0,12)]).toEqual([0,0,255,255, 0,0,255,255, 0,0,0,0]);
  expect(alpha[15]).toBe(192);
  // luma mode: the opaque black pixel has zero luminance and unmattes.
  await doc.setLayerMatte(target,{source_layer:source,mode:'luma'});
  const luma=await frame();
  expect([...luma.subarray(0,12)]).toEqual([0,0,255,255, 0,0,0,255, 0,0,0,0]);
  // alpha-inverted flips the mask: the white pixels unmatt the target.
  await doc.setLayerMatte(target,{source_layer:source,mode:'alpha-inverted'});
  const inverted=await frame();
  expect([...inverted.subarray(0,8)]).toEqual([255,255,255,255, 0,0,0,255]);
  // describe exposes the stored matte; cycles and bad refs reject.
  const described=(await doc.describe()).data;
  const tl=described.layers.find(l=>l.id===target)!;
  expect(tl.matte).toEqual({source_layer:source,mode:'alpha-inverted',feather:0,enabled:true});
  await expect(doc.setLayerMatte(source,{source_layer:target,mode:'alpha'})).rejects.toThrow();
  await expect(doc.setLayerMatte(target,{source_layer:99,mode:'alpha'})).rejects.toThrow();
  await expect(doc.setLayerMatte(target,{source_layer:source,mode:'alpha',feather:65})).rejects.toThrow();
  // Undo removes the inverted matte, redo restores it; null clears.
  await doc.undo();
  expect((await doc.describe()).data.layers.find(l=>l.id===target)!.matte!.mode).toBe('luma');
  await doc.redo();
  await doc.setLayerMatte(target,null);
  expect((await doc.describe()).data.layers.find(l=>l.id===target)!.matte).toBeUndefined();
  expect([...(await frame()).subarray(0,8)]).toEqual([0,0,255,255, 0,0,255,255]);
 }finally{await doc?.close();await host.dispose();}
});
