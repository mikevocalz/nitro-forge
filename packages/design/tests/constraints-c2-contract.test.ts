import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('runs C2 constraint bounds, aspect flag and relative targets through the real nf-cli engine',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const {data:{node_id:rect}}=await doc.addShape(1,'rect',{x:1,y:1,width:2,height:2});
  const {data:{node_id:sibling}}=await doc.addShape(1,'rect',{x:5,y:5,width:1,height:1});
  // Full C2 set: extent bounds, aspect flag, sibling relative target.
  await doc.setConstraints(rect,{horizontal:'left',vertical:'top',min_width:1,max_width:8,min_height:0.5,max_height:4,aspect_locked:true,relative_to:sibling});
  const state=await doc.describe();
  expect(state.data.nodes[String(rect)]!.constraints).toEqual({horizontal:'left',vertical:'top',min_width:1,max_width:8,min_height:0.5,max_height:4,aspect_locked:true,relative_to:sibling});
  const read=(await doc.readConstraints(rect)).data;
  expect(read.solving).toBe('evaluateLayout');
  expect(read.accepted.relative_to).toEqual(['parent','sibling']);
  expect(read.nodes).toEqual([{node_id:rect,constraints:{horizontal:'left',vertical:'top',min_width:1,max_width:8,min_height:0.5,max_height:4,aspect_locked:true,relative_to:sibling},enforced:true,satisfied:true}]);
  // Enforcement is live: left/top pin flush to the sibling's box (5,5).
  const boxes=(await doc.evaluateLayout()).data.boxes;
  expect(boxes.find(b=>b.id===rect)).toMatchObject({x:5,y:5});
  // Validation rejections surface as engine errors.
  await expect(doc.setConstraints(rect,{horizontal:'left',vertical:'top',min_width:9,max_width:2})).rejects.toThrow(/minimum exceeds maximum/);
  await expect(doc.setConstraints(rect,{horizontal:'left',vertical:'top',min_height:-1})).rejects.toThrow(/bounds/);
  await expect(doc.setConstraints(rect,{horizontal:'left',vertical:'top',max_width:1e8})).rejects.toThrow(/bounds/);
  await expect(doc.setConstraints(rect,{horizontal:'left',vertical:'top',relative_to:rect})).rejects.toThrow(/relative_to/);
  await expect(doc.setConstraints(rect,{horizontal:'left',vertical:'top',relative_to:9999})).rejects.toThrow(/relative_to/);
  // min==max and lone bounds are admitted.
  await doc.setConstraints(rect,{horizontal:'right',vertical:'bottom',min_width:3,max_width:3});
  // A node under another parent is outside the sibling scope.
  const {data:{node_id:frame}}=await doc.addFrame(1,{x:10,y:0,width:6,height:6});
  const {data:{node_id:cousin}}=await doc.addShape(frame,'rect',{x:0,y:0,width:1,height:1});
  await expect(doc.setConstraints(rect,{horizontal:'left',vertical:'top',relative_to:cousin})).rejects.toThrow(/relative_to/);
  // Removing a relative_to target rejects atomically while referenced.
  await doc.setConstraints(rect,{horizontal:'left',vertical:'top',relative_to:sibling});
  await expect(doc.removeNode(sibling)).rejects.toThrow();
  expect((await doc.describe()).data.nodes[String(sibling)]).toBeDefined();
  // Snapshot keeps the schema:2 wrapper and reopens with C2 fields intact.
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect((await reopened.describe()).data.nodes[String(rect)]!.constraints).toEqual({horizontal:'left',vertical:'top',relative_to:sibling});
  // Undo/redo across set and clear.
  await doc.setConstraints(rect,null);
  expect((await doc.describe()).data.nodes[String(rect)]!.constraints).toBeUndefined();
  await doc.undo();
  expect((await doc.describe()).data.nodes[String(rect)]!.constraints!.relative_to).toBe(sibling);
  await doc.redo();
  expect((await doc.describe()).data.nodes[String(rect)]!.constraints).toBeUndefined();
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
