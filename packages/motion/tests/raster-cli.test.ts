import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument,MOTION_RASTER_FORMAT} from '../src/index';
it('owns caller Buffer subviews before await and renders shared immutable assets through CLI',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined,reopened:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:2,height:1,duration_s:1});
  const caller=Buffer.from([77,255,0,0,255,88]);const pending=doc.addRasterAsset(1,1,caller.subarray(1,5));caller.fill(0);const asset=(await pending).data.asset_id;
  expect((await doc.readRasterAsset(asset)).data).toMatchObject({width:1,height:1,format:MOTION_RASTER_FORMAT,pixels_b64:Buffer.from([255,0,0,255]).toString('base64')});
  const first=(await doc.addRasterLayer(asset)).data.layer_id;const second=(await doc.addRasterLayer(asset)).data.layer_id;await doc.updateLayer(second,{transform:{tx:1}});
  expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([255,0,0,255,255,0,0,255]).toString('base64'));
  await doc.updateLayer(first,{visible:false});await doc.updateLayer(second,{opacity:0.5});expect((await doc.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([0,0,0,0,255,0,0,128]).toString('base64'));
  const bytes=await doc.save();await expect(doc.removeRasterAsset(asset)).rejects.toThrow();expect(await doc.save()).toEqual(bytes);
  reopened=await MotionDocument.openSnapshot(host,bytes);expect(await reopened.save()).toEqual(bytes);expect((await reopened.describe()).data.layers.every(layer=>layer.asset_id===asset&&layer.shape===undefined)).toBe(true);
  expect(()=>doc!.addRasterAsset(1,1,new Uint8Array(3))).toThrow();
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
it('materializes empty asset defaults in empty and legacy-shape describe responses',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined,legacy:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:1,height:1});const empty=(await doc.describe()).data;
  expect(empty.assets).toEqual({});expect(empty.next_asset_id).toBe(1);
  await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[0,0,255,255]});
  const snapshot=await doc.save();
  // Preserve exact f64 spelling/order from Rust while removing only additive empty fields.
  const oldPayload=Buffer.from(snapshot.subarray(9)).toString('utf8').replace(/,"assets":\{\},"next_asset_id":1(?=\})/,'');
  const oldState=JSON.parse(oldPayload);expect(oldState.assets).toBeUndefined();expect(oldState.next_asset_id).toBeUndefined();
  const payload=Buffer.from(oldPayload);const oldEnvelope=Buffer.alloc(9+payload.byteLength);oldEnvelope.write('NFD1',0,'ascii');oldEnvelope[4]=0;oldEnvelope.writeUInt32LE(payload.byteLength,5);payload.copy(oldEnvelope,9);
  legacy=await MotionDocument.openSnapshot(host,oldEnvelope);const described=(await legacy.describe()).data;
  expect(described.assets).toEqual({});expect(described.next_asset_id).toBe(1);expect(described.layers[0]!.shape).toMatchObject({kind:'rect'});expect(described.layers[0]!.asset_id).toBeUndefined();
  expect(await legacy.save()).toEqual(Uint8Array.from(oldEnvelope));
  expect((await legacy.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([0,0,255,255]).toString('base64'));
 }finally{await legacy?.close();await doc?.close();await host.dispose();}
});
