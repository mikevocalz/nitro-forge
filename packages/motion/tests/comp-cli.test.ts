import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives nested compositions, transform parenting and raster retarget through the TS facade',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:4,height:1,duration_s:1});
  const inner=await doc.addComposition({width:4,height:1,name:'Inner'});
  const cid=inner.data.comp_id;
  const parent=await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[0,0,255,255]},'parent',cid);
  const child=await doc.addShapeLayer({kind:'rect',x:1,y:0,w:1,h:1,fill:[255,0,0,255]},'child',cid);
  await doc.setLayerParent(child.data.layer_id,parent.data.layer_id);
  await doc.updateLayer(parent.data.layer_id,{transform:{tx:2}});
  const inst=await doc.addCompLayer(cid,'instance');
  const other=await doc.addComposition({width:4,height:1,name:'Other'});
  await doc.reparentLayer(inst.data.layer_id,other.data.comp_id,0);
  const dup=await doc.duplicateComposition(cid);
  const state=(await doc.describe()).data;
  expect(state.compositions[String(cid)]!.layers).toHaveLength(2);
  const copied=state.compositions[String(dup.data.comp_id)]!.layers;
  expect(copied).toHaveLength(2);
  expect(copied.map(l=>l.id)).not.toContain(child.data.layer_id);
  // Parent links are remapped to the copy's fresh layer identities.
  const copiedParent=copied.find(l=>l.name==='parent')!;
  const copiedChild=copied.find(l=>l.name==='child')!;
  expect(copiedChild.parent_id).toBe(copiedParent.id);
  const ev=(await doc.evaluate(0)).data;
  const evaluated=ev.compositions[String(cid)]!.layers.find(l=>l.id===child.data.layer_id)!;
  expect(evaluated.parent_id).toBe(parent.data.layer_id);
  expect(evaluated.transform.tx).toBe(0);
  // updateLayer asset_id retargets a raster layer to another valid asset.
  const a1=(await doc.addRasterAsset(1,1,new Uint8Array([9,9,9,255]))).data.asset_id;
  const a2=(await doc.addRasterAsset(1,1,new Uint8Array([1,2,3,255]))).data.asset_id;
  const rl=(await doc.addRasterLayer(a1,'r')).data.layer_id;
  await doc.updateLayer(rl,{asset_id:a2});
  await expect(doc.updateLayer(rl,{asset_id:999})).rejects.toThrow();
  const described=(await doc.describe()).data;
  expect(described.layers.find(l=>l.id===rl)!.asset_id).toBe(a2);
  const frame=await doc.renderFrame(0);
  expect(frame.data.width).toBe(4);
  expect(frame.data.pixels_b64).toBeTruthy();
 }finally{await doc?.close();await host.dispose();}
});
