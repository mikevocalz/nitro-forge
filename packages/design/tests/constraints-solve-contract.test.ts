import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('solves design constraints through the real nf-cli engine: anchors, bounds, aspect, siblings, cycles',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const box=async(id:number)=>(await doc!.evaluateLayout()).data.boxes.find(b=>b.id===id)!;
  // right/bottom pin flush to the root canvas and follow resizes.
  const {data:{node_id:rect}}=await doc.addShape(1,'rect',{x:15,y:5,width:2,height:2});
  await doc.setConstraints(rect,{horizontal:'right',vertical:'bottom'});
  expect(await box(rect)).toMatchObject({x:18,y:8,width:2,height:2});
  await doc.setComposition({width:30,height:20});
  expect(await box(rect)).toMatchObject({x:28,y:18});
  // center pins the midpoint on both axes.
  const {data:{node_id:ctr}}=await doc.addShape(1,'rect',{x:4,y:3,width:4,height:2});
  await doc.setConstraints(ctr,{horizontal:'center',vertical:'center'});
  expect(await box(ctr)).toMatchObject({x:13,y:9});
  // stretch spans the reference extent.
  const {data:{node_id:str}}=await doc.addShape(1,'rect',{x:2,y:1,width:4,height:3});
  await doc.setConstraints(str,{horizontal:'stretch',vertical:'stretch'});
  expect(await box(str)).toMatchObject({x:0,y:0,width:30,height:20});
  // A bound the stretch cannot satisfy marks the node unsatisfied and it
  // keeps unconstrained geometry; evaluateLayout and readConstraints agree.
  const {data:{node_id:bounded}}=await doc.addShape(1,'rect',{x:1,y:1,width:2,height:2});
  await doc.setConstraints(bounded,{horizontal:'stretch',vertical:'top',max_width:5});
  const layout=(await doc.evaluateLayout()).data;
  expect(layout.constraints.status).toBe('partial');
  expect(layout.constraints.unsatisfied).toContain(bounded);
  expect(layout.boxes.find(b=>b.id===bounded)).toMatchObject({x:1,y:1,width:2,height:2});
  const read=(await doc.readConstraints(bounded)).data;
  expect(read.solve.status).toBe('partial');
  expect(read.nodes).toEqual([{node_id:bounded,constraints:{horizontal:'stretch',vertical:'top',max_width:5},enforced:true,satisfied:false}]);
  // aspect_locked derives the authored 2:1 ratio under vertical stretch.
  const {data:{node_id:aspect}}=await doc.addShape(1,'rect',{x:1,y:1,width:4,height:2});
  await doc.setConstraints(aspect,{horizontal:'left',vertical:'stretch',aspect_locked:true});
  expect(await box(aspect)).toMatchObject({x:0,y:0,width:40,height:20});
  // Sibling relative_to tracks the sibling's solved box.
  const {data:{node_id:anchor}}=await doc.addShape(1,'rect',{x:6,y:1,width:2,height:2});
  const {data:{node_id:follower}}=await doc.addShape(1,'rect',{x:10,y:1,width:2,height:2});
  await doc.setConstraints(follower,{horizontal:'right',vertical:'top',relative_to:anchor});
  expect(await box(follower)).toMatchObject({x:6,y:1});
  await doc.updateNode(anchor,{x:12});
  expect(await box(follower)).toMatchObject({x:12,y:1});
  // Mutually referencing constrained siblings cycle: both keep authored
  // geometry and report unsatisfied rather than corrupting the layout.
  const {data:{node_id:cycA}}=await doc.addShape(1,'rect',{x:3,y:6,width:1,height:1});
  const {data:{node_id:cycB}}=await doc.addShape(1,'rect',{x:7,y:6,width:1,height:1});
  await doc.setConstraints(cycA,{horizontal:'left',vertical:'top',relative_to:cycB});
  await doc.setConstraints(cycB,{horizontal:'left',vertical:'top',relative_to:cycA});
  expect((await doc.evaluateLayout()).data.constraints.unsatisfied).toEqual(expect.arrayContaining([cycA,cycB]));
  expect(await box(cycA)).toMatchObject({x:3,y:6});
  // Nested absolute frames scope constraints to their own evaluated box.
  const {data:{node_id:frame}}=await doc.addFrame(1,{x:5,y:5,width:10,height:10});
  const {data:{node_id:inner}}=await doc.addShape(frame,'rect',{x:0,y:0,width:2,height:2});
  await doc.setConstraints(inner,{horizontal:'right',vertical:'bottom',relative_to:frame});
  expect(await box(inner)).toMatchObject({x:13,y:13});
  // Snapshot round-trips: solving is derived, so bytes are unchanged.
  const bytes=await doc.save();
  const reopened=await DesignDocument.openSnapshot(host,bytes);
  try{expect(await reopened.save()).toEqual(bytes);}finally{await reopened.close();}
 }finally{await doc?.close();await host.dispose();}
});
