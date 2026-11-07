import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('runs constraint anchors through the real nf-cli engine: store, read, wrapper snapshot, clear, rejections',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const {data:{node_id}}=await doc.addShape(1,'rect',{x:1,y:1,width:2,height:2});
  await doc.setConstraints(node_id,{horizontal:'left',vertical:'top',relative_to:1});
  const state=await doc.describe();
  expect(state.data.nodes[String(node_id)]!.constraints).toEqual({horizontal:'left',vertical:'top',relative_to:1});
  const read=(await doc.readConstraints(node_id)).data;
  expect(read.solving).toBe('storage-only');
  expect(read.nodes).toEqual([{node_id,constraints:{horizontal:'left',vertical:'top',relative_to:1},enforced:false}]);
  // Storage only: evaluated boxes keep authored coordinates.
  const boxes=(await doc.evaluateLayout()).data.boxes;
  expect(boxes.find(b=>b.id===node_id)).toMatchObject({x:1,y:1});
  // Rejections surface as engine errors with reasons.
  await expect(doc.setConstraints(1,{horizontal:'left',vertical:'top'})).rejects.toThrow(/root/);
  await expect(doc.setConstraints(node_id,{horizontal:'scale',vertical:'top'})).rejects.toThrow(/scale/);
  // C2 admits siblings as relative_to targets; a node under a different
  // parent is still out of scope.
  const other=(await doc.addFrame(1,{x:8,y:0,width:6,height:6})).data.node_id;
  const cousin=(await doc.addShape(other,'rect',{x:0,y:0,width:1,height:1})).data.node_id;
  await expect(doc.setConstraints(node_id,{horizontal:'left',vertical:'top',relative_to:cousin})).rejects.toThrow(/relative_to/);
  // Siblings are in scope now.
  const sibling=(await doc.addShape(1,'rect',{x:5,y:5,width:1,height:1})).data.node_id;
  await doc.setConstraints(node_id,{horizontal:'left',vertical:'top',relative_to:sibling});
  // Flow parents reject anchored children both ways.
  const frame=(await doc.addFrame(1,{x:8,y:0,width:6,height:6})).data.node_id;
  await doc.setFrameLayout(frame,{direction:'row',gap:0,padding_top:0,padding_right:0,padding_bottom:0,padding_left:0,align:'start',justify:'start'});
  const flowkid=(await doc.addShape(frame,'rect',{x:0,y:0,width:1,height:1})).data.node_id;
  await expect(doc.setConstraints(flowkid,{horizontal:'left',vertical:'top'})).rejects.toThrow(/absolute/);
  await expect(doc.setFrameLayout(1,{direction:'row',gap:0,padding_top:0,padding_right:0,padding_bottom:0,padding_left:0,align:'start',justify:'start'})).rejects.toThrow(/absolute/);
  // Snapshot carries the schema:2 wrapper and reopens with anchors intact.
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect((await reopened.describe()).data.nodes[String(node_id)]!.constraints!.horizontal).toBe('left');
  // Undo/redo across set and clear.
  await doc.setConstraints(node_id,null);
  expect((await doc.describe()).data.nodes[String(node_id)]!.constraints).toBeUndefined();
  await doc.undo();
  expect((await doc.describe()).data.nodes[String(node_id)]!.constraints!.vertical).toBe('top');
  await doc.redo();
  expect((await doc.describe()).data.nodes[String(node_id)]!.constraints).toBeUndefined();
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
