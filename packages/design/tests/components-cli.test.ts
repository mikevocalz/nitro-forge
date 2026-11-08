import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';
import type {DesignNode} from '../src/index';

it('runs components and instances through the real nf-cli engine: expansion, overrides, variants, detach, snapshot, history',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const {data:{node_id:frame}}=await doc.addFrame(1,{x:0,y:0,width:10,height:10});
  const {data:{node_id:child}}=await doc.addShape(frame,'rect',{x:1,y:1,width:2,height:2,fill:[9,8,7,255]});
  await doc.createComponent(frame,{name:'Card'});
  const state=await doc.describe();
  expect(state.data.nodes[String(frame)]!.kind).toBe('component');
  const {data:{node_id:inst}}=await doc.createInstance(frame,{parent:1,x:5,y:0,width:10,height:10});
  const stored=(await doc.describe()).data.nodes[String(inst)]!;
  expect(stored.kind).toBe('instance');
  expect(stored.instance).toMatchObject({component:frame});
  expect(stored.instance!.overrides ?? []).toEqual([]);
  expect(stored.children).toEqual([]);
  // evaluateLayout expands deterministically: instance box plus a synthetic
  // child clone (id >= 2^53) at the component child's local offset.
  const boxes=(await doc.evaluateLayout()).data.boxes;
  const synth=boxes.find(b=>b.id>Number.MAX_SAFE_INTEGER)!;
  expect(synth).toMatchObject({x:6,y:1,width:2,height:2});
  // Overrides apply at expansion only; stored state is untouched.
  await doc.updateInstance(inst,{overrides:[{node:child,path:'fill',value:[1,2,3,255]},{node:frame,path:'fill',value:[4,5,6,255]}]});
  const pixels=Buffer.from((await doc.renderFrame()).data.pixels_b64!,'base64');
  expect([...pixels.slice((1*20+6)*4,(1*20+6)*4+4)]).toEqual([1,2,3,255]);
  expect([...pixels.slice((7*20+7)*4,(7*20+7)*4+4)]).toEqual([4,5,6,255]);
  expect((await doc.describe()).data.nodes[String(inst)]!.instance!.overrides).toHaveLength(2);
  // Variant bundles select by name through describeComponents.
  await doc.updateComponent(frame,{variants:[{name:'alt',properties:[{node:child,path:'x',value:3}]}]});
  const catalog=(await doc.describeComponents()).data;
  expect(catalog.components[0]!.variants[0]!.name).toBe('alt');
  expect(catalog.instances[0]).toMatchObject({component:frame});
  expect(catalog.instances[0]!.unavailable_reason).toBeUndefined();
  await doc.updateInstance(inst,{variant:'alt'});
  expect(((await doc.describe()).data.nodes[String(inst)] as DesignNode).instance!.variant).toBe('alt');
  // Snapshot uses the schema:2 wrapper and round-trips byte-identically.
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  // Undo/redo across instance writes.
  await doc.undo();expect(((await doc.describe()).data.nodes[String(inst)] as DesignNode).instance!.variant).toBeUndefined();
  await doc.redo();expect(((await doc.describe()).data.nodes[String(inst)] as DesignNode).instance!.variant).toBe('alt');
  // Detach materializes the expansion as ordinary nodes.
  await doc.detachInstance(inst);
  const detached=(await doc.describe()).data.nodes[String(inst)]!;
  expect(detached.kind).toBe('frame');
  expect(detached.instance).toBeUndefined();
  expect(detached.children).toHaveLength(1);
  await doc.undo();expect((await doc.describe()).data.nodes[String(inst)]!.kind).toBe('instance');
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
