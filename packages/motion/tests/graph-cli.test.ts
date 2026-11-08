import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {MotionDocument,type MotionGraphNode} from '../src/index';
it('drives a scalar value graph through setGraph, evaluate and renderFrame via nf-cli',async()=>{
 const host=new CliHost();let doc:MotionDocument|undefined;
 try{
  doc=await MotionDocument.open(host,{width:8,height:1,duration_s:1});
  const layer=(await doc.addShapeLayer({kind:'rect',x:0,y:0,w:1,h:1,fill:[255,0,0,255]},'mover')).data.layer_id;
  // tx = time * 8 → 2 at t=0.25, 8 at t=1; rotation = frame (floor(time*30)).
  const nodes:MotionGraphNode[]=[
   {id:1,kind:'time',inputs:{}},
   {id:2,kind:'const',params:{value:8},inputs:{}},
   {id:3,kind:'mul',inputs:{a:{node:1},b:{node:2}}},
   {id:4,kind:'frame',inputs:{}},
  ];
  await doc.setGraph({nodes,bindings:[{layer,property:'tx',node:3},{layer,property:'rotation',node:4}]});
  const ev=await doc.evaluate(0.25);
  const moved=ev.data.layers.find(l=>l.id===layer)!;
  expect(moved.transform.tx).toBeCloseTo(2,9);
  expect(moved.transform.rotation).toBeCloseTo(7,9); // frame=floor(0.25*30)=7
  const described=(await doc.describe()).data;
  expect(described.graph!.nodes).toHaveLength(4);
  expect(described.graph!.bindings).toHaveLength(2);
  expect(described.graph!.next_node_id).toBe(5);
  // Mutual exclusion: keys on tx clear the tx binding atomically.
  await doc.setPropertyKeys(layer,'tx',[
   {time:0,value:0,interpolation:'linear',in_handle:null,out_handle:null},
   {time:1,value:4,interpolation:'linear',in_handle:null,out_handle:null},
  ]);
  const after=(await doc.describe()).data;
  expect(after.graph!.bindings!.map(b=>b.property)).toEqual(['rotation']);
  expect((await doc.evaluate(1)).data.layers.find(l=>l.id===layer)!.transform.tx).toBeCloseTo(4,9);
  // Rejections are atomic and leave state untouched.
  const before=(await doc.describe()).data;
  await expect(doc.setGraph({nodes:[{id:1,kind:'bogus' as never,inputs:{}}],bindings:[]})).rejects.toThrow();
  await expect(doc.setGraph({nodes:[{id:1,kind:'mul',inputs:{a:{node:2},b:{const:1}}}],bindings:[]})).rejects.toThrow();
  expect((await doc.describe()).data).toEqual(before);
  // Undo the keys write restores the tx binding; setGraph null clears all.
  await doc.undo();
  expect((await doc.describe()).data.graph!.bindings!.map(b=>b.property)).toContain('tx');
  await doc.setGraph(null);
  expect((await doc.describe()).data.graph).toBeUndefined();
  // Real pixels: a fresh graph binds opacity to a time comparison.
  await doc.setGraph({nodes:[
   {id:1,kind:'time',inputs:{}},
   {id:2,kind:'const',params:{value:0.5},inputs:{}},
   {id:3,kind:'gt',inputs:{a:{node:1},b:{node:2}}},
  ],bindings:[{layer,property:'opacity',node:3}]});
  const frame=async(t:number)=>Buffer.from((await doc.renderFrame(t)).data.pixels_b64!,'base64');
  // opacity = (time > 0.5): hidden early, visible late at tx=0 → pixel[3].
  const early=await frame(0.25);
  expect(early[3]).toBe(0);
  const late=await frame(0.75);
  expect(late[3]).toBeGreaterThan(0);
 }finally{await doc?.close();await host.dispose();}
});
