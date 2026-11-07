import {expect,it} from 'vitest';
import {CliHost} from '../src/host-cli';
import {PhotoDocument,type PhotoDevelopV1} from '../../photo/src/index';
import {MotionDocument} from '../../motion/src/index';

it('processes declared decoded pixels into an owned Motion raster and reopens real frames',async()=>{
 const host=new CliHost();
 let photo:PhotoDocument|undefined,motion:MotionDocument|undefined,reopened:MotionDocument|undefined;
 try{
  photo=await PhotoDocument.open(host);
  const original=await photo.addOriginal({sha256:'a'.repeat(64),asset_ref:'retained:synthetic-fixture',byte_length:4,camera_make:'',camera_model:''});
  const recipe:PhotoDevelopV1={schema:1,exposure_ev:1,contrast:1,rgb_gain:[1,1,1]};
  await photo.setDevelop(original.data.version_id,recipe);
  const beforePreview=await photo.save();
  const input=new Uint8Array([128,64,32,99]);
  const preview=await photo.processPreview({version_id:original.data.version_id,original_id:original.data.original_id,original_sha256:'a'.repeat(64),expected_develop:recipe,width:1,height:1,format:'rgba8-straight-srgb'},input);
  expect([...preview.pixels]).toEqual([176,90,47,99]);
  expect([...input]).toEqual([128,64,32,99]);
  expect(await photo.save()).toEqual(beforePreview);
  motion=await MotionDocument.open(host,{width:1,height:1});
  const ingest=motion.addRasterAsset(1,1,preview.pixels);
  preview.pixels.fill(0);
  const asset=await ingest;
  await motion.addRasterLayer(asset.data.asset_id);
  const expected=Buffer.from([176,90,47,99]).toString('base64');
  expect((await motion.renderFrame(0)).data.pixels_b64).toBe(expected);
  const snapshot=await motion.save();
  expect(await motion.undo()).toBe(true);
  expect((await motion.renderFrame(0)).data.pixels_b64).toBe(Buffer.from([0,0,0,0]).toString('base64'));
  expect(await motion.redo()).toBe(true);
  reopened=await MotionDocument.openSnapshot(host,snapshot);
  expect((await reopened.renderFrame(0)).data.pixels_b64).toBe(expected);
  expect(await reopened.save()).toEqual(snapshot);
 }finally{
  await reopened?.close();await motion?.close();await photo?.close();await host.dispose();
 }
});
