import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('drives motion paths through the TS facade and nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:1,duration_s:1});
  const layer=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[255,0,0,255]},'mover')).data.layer_id;
  const path={nodes:[{x:0,y:0},{x:7,y:0}]};
  await doc.setMotionPath(layer,path);
  await doc.setPropertyKeys(layer,'path_progress',[
   {time:0,value:0,interpolation:'linear',in_handle:null,out_handle:null},
   {time:1,value:1,interpolation:'linear',in_handle:null,out_handle:null},
  ]);
  const frame=async(t:number)=>Buffer.from((await doc.renderFrame(t)).data.pixels_b64!,'base64');
  const start=await frame(0),stop=await frame(1);
  expect(start[3]).toBe(255);expect(start[7*4+3]).toBe(0);
  expect(stop[7*4+3]).toBe(255);expect(stop[3]).toBe(0);
  // evaluate reports the path-offset transform and evaluated progress.
  const ev=await doc.evaluate(1);
  const moved=ev.data.layers.find(l=>l.id===layer)!;
  expect(moved.transform.tx).toBe(7);
  expect(moved.path_progress).toBe(1);
  expect(moved.path).toEqual(path);
  // path_progress without a path and oversized paths reject; clear removes curve.
  const bare=(await doc.addShapeLayer({kind:'rect',x:4,y:0,w:1,h:1,fill:[0,255,0,255]},'bare')).data.layer_id;
  await expect(doc.setPropertyKeys(bare,'path_progress',[
   {time:0,value:0,interpolation:'hold',in_handle:null,out_handle:null},
  ])).rejects.toThrow();
  await expect(doc.setMotionPath(layer,{nodes:Array.from({length:257},(_,i)=>({x:i,y:0}))})).rejects.toThrow();
  await doc.setMotionPath(layer,null);
  const described=(await doc.describe()).data;
  const cleared=described.layers.find(l=>l.id===layer)!;
  expect(cleared.path).toBeUndefined();
  expect(cleared.curves).toEqual([]);
  expect([...(await frame(1)).subarray(0,4)]).toEqual([255,0,0,255]);
  // Undo restores the path+curve, redo re-clears.
  await doc.undo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.path).toEqual(path);
  await doc.redo();
  expect((await doc.describe()).data.layers.find(l=>l.id===layer)!.path).toBeUndefined();
 }finally{await doc?.close();await host.dispose();}
});
