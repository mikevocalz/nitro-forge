import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('runs text nodes through the real nf-cli engine: layout, sizing, pixels, wrapper snapshot, history',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const {data:{node_id}}=await doc.addText(1,{content:'Hi',fill:[9,8,7,255]});
  const state=await doc.describe();
  expect(state.data.nodes[String(node_id)]).toMatchObject({kind:'text',text:{content:'Hi',font_size:16}});
  const boxes=(await doc.evaluateLayout()).data.boxes;
  expect(boxes.find(b=>b.id===node_id)).toMatchObject({kind:'text',renderable:false});
  await doc.setAxisSizing(node_id,'x',{mode:'hug'});
  await doc.setAxisSizing(node_id,'y',{mode:'hug'});
  const caps=(await doc.readAxisSizing(node_id)).data;
  expect(caps.x.resolvedValue).toBeCloseTo(19.2,10);
  expect(caps.y.resolvedValue).toBeCloseTo(19.2,10);
  const pixels=Buffer.from((await doc.renderFrame()).data.pixels_b64!,'base64');
  expect([...pixels.slice(0,4)]).toEqual([9,8,7,255]);
  await doc.updateNode(node_id,{text:{content:'Hello',font_size:20}});
  expect((await doc.describe()).data.nodes[String(node_id)]!.text).toMatchObject({content:'Hello',font_size:20,font_weight:400});
  // Snapshot carries the schema:2 wrapper and reopens byte-identically.
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect((await reopened.describe()).data.nodes[String(node_id)]!.kind).toBe('text');
  await doc.undo();expect((await doc.describe()).data.nodes[String(node_id)]!.text!.content).toBe('Hi');
  await doc.redo();expect((await doc.describe()).data.nodes[String(node_id)]!.text!.content).toBe('Hello');
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
