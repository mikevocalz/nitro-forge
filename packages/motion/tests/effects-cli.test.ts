import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives the bounded effect stack through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:2,height:1,duration_s:1});
  const asset=(await doc.addRasterAsset(2,1,new Uint8Array([
   10,20,30,255, 200,100,50,255]))).data.asset_id;
  const layer=(await doc.addRasterLayer(asset,'fx')).data.layer_id;
  const frame=async()=>Buffer.from((await doc.renderFrame(0)).data.pixels_b64!,'base64');
  // invert is pixel-exact on both pixels.
  await doc.setLayerEffects(layer,[{kind:'invert'}]);
  expect([...(await frame()).subarray(0,8)]).toEqual([245,235,225,255,55,155,205,255]);
  // Stack order matters: brightness clamps before invert here.
  await doc.setLayerEffects(layer,[{kind:'brightness',amount:1},{kind:'invert'}]);
  expect([...(await frame()).subarray(0,4)]).toEqual([0,0,0,255]);
  // fill replaces RGB, preserves alpha; describe exposes the stored stack.
  await doc.setLayerEffects(layer,[{kind:'fill',color:[0,255,0,128]}]);
  const described=(await doc.describe()).data;
  // opacity defaults to 1 and is omitted from the serialized stack.
  expect(described.layers.find(l=>l.id===layer)!.effects).toEqual([{kind:'fill',color:[0,255,0,128]}]);
  const filled=await frame();
  expect(filled[1]).toBe(255);expect(filled[4+1]).toBe(255);
  // gaussian-blur is accepted within bounds and rejects outside them.
  await doc.setLayerEffects(layer,[{kind:'gaussian-blur',radius_px:8}]);
  await expect(doc.setLayerEffects(layer,[{kind:'gaussian-blur',radius_px:65}])).rejects.toThrow();
  await expect(doc.setLayerEffects(layer,[{kind:'sepia'} as never])).rejects.toThrow();
  // null clears; undo/redo round-trips the stack.
  await doc.setLayerEffects(layer,null);
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.effects).toBeUndefined();
  expect([...(await frame()).subarray(0,4)]).toEqual([10,20,30,255]);
  await doc.undo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.effects).toHaveLength(1);
  await doc.redo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.effects).toBeUndefined();
 }finally{await doc?.close();}
});
