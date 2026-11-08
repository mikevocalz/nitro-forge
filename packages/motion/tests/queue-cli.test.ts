import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument} from '../src/index';
it('durable render queue steps real RGBA frames with exact progress through CLI',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined,reopened:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:2,height:1,duration_s:1,frame_rate:{num:2,den:1}});
  const layer=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[255,0,0,255]})).data.layer_id;
  await doc.setPropertyKeys(layer,'tx',[{time:0,value:0,interpolation:'linear',in_handle:null,out_handle:null},{time:1,value:1,interpolation:'linear',in_handle:null,out_handle:null}]);
  const a=(await doc.addRenderJob({name:'A',from_frame:0,to_frame:1})).data.job_id;
  const b=(await doc.addRenderJob({from_frame:0,to_frame:0})).data.job_id;
  const state=(await doc.describe()).data;
  expect(state.render_queue!.map(j=>j.id)).toEqual([a,b]);
  expect(state.next_job_id).toBe(3);
  await doc.setRenderQueueOrder([b,a]);
  // First pending job in the new order is b (single frame).
  const first=await doc.renderQueueFrame();
  expect(first.data.job_id).toBe(b);
  expect(first.data.frames_done).toBe(1);
  expect(first.data.frames_total).toBe(1);
  expect(first.data.status).toBe('done');
  expect(first.data.queue).toMatchObject({jobs:2,pending:1,done:1,cancelled:0,pending_frames:2});
  // Stepped pixels are the real renderFrame output at the job's mapped time.
  expect(first.data.pixels_b64).toBe((await doc.renderFrame(0)).data.pixels_b64);
  const second=await doc.renderQueueFrame();
  expect(second.data.job_id).toBe(a);
  expect(second.data.frame).toBe(0);
  expect(second.data.pixels_b64).toBe((await doc.renderFrame(0)).data.pixels_b64);
  const third=await doc.renderQueueFrame();
  expect(third.data.frame).toBe(1);
  expect(third.data.status).toBe('done');
  expect(third.data.pixels_b64).toBe((await doc.renderFrame(0.5)).data.pixels_b64);
  await expect(doc.renderQueueFrame()).rejects.toThrow();
  // Queue state is durable: snapshot/reopen preserves jobs and progress.
  const bytes=await doc.save();
  reopened=await MotionDocument.openSnapshot(host,bytes);
  const restored=(await reopened.describe()).data;
  expect(restored.render_queue!.map(j=>[j.id,j.status,j.frames_done])).toEqual([[b,'done',1],[a,'done',2]]);
  expect(await reopened.save()).toEqual(bytes);
  // Undo rewinds real stepped progress.
  expect(await doc.undo()).toBe(true);
  expect((await doc.describe()).data.render_queue![1]!.frames_done).toBe(1);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
it('cancel and comp-removal guard behave through CLI',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:1,height:1,duration_s:1});
  const comp=(await doc.addComposition({width:1,height:1,duration_s:1})).data.comp_id;
  const j=(await doc.addRenderJob({comp,from_frame:0,to_frame:0})).data.job_id;
  await expect(doc.removeComposition(comp)).rejects.toThrow();
  await doc.cancelRenderJob(j);
  await expect(doc.removeComposition(comp)).rejects.toThrow();
  await doc.removeRenderJob(j);
  await doc.removeComposition(comp);
  await expect(doc.renderQueueFrame()).rejects.toThrow();
 }finally{await doc?.close();await host.dispose();}
});
