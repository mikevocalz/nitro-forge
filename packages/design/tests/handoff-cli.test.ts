import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('runs describeHandoff and exportSlice through the real nf-cli engine',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:40,height:30});
  const frame=(await doc.addFrame(1,{name:'Card',x:4,y:4,width:20,height:10,fill:[200,100,50,255]})).data.node_id;
  const child=(await doc.addShape(frame,'rect',{x:1,y:1,width:4,height:4,fill:[0,255,0,255]})).data.node_id;
  const text=(await doc.addText(frame,{name:'Title',content:'Handoff',style:{font_size:12}})).data.node_id;
  const sibling=(await doc.addShape(1,'rect',{x:30,y:20,width:4,height:4,fill:[255,0,0,255]})).data.node_id;
  await doc.definePrototypeScreen(frame,{entry:true});
  // describeHandoff: deterministic, eventless, revision-tagged.
  const h1=(await doc.describeHandoff()).data;
  const h2=(await doc.describeHandoff()).data;
  expect(h2).toEqual(h1);
  expect(h1.units).toBe('document');
  expect(h1.assets).toEqual([]);
  expect(h1.screens).toHaveLength(1);
  expect(h1.screens[0]).toMatchObject({node:frame,entry:true,kind:'frame'});
  expect(h1.measurements.boxes.length).toBe(h1.measurements.total);
  expect(h1.measurements.truncated).toBe(false);
  const ids=h1.nodes.map(n=>n.id);
  expect(ids).toContain(frame);expect(ids).toContain(child);expect(ids).toContain(text);expect(ids).toContain(sibling);
  const tn=h1.nodes.find(n=>n.id===text)!;
  expect(tn.text?.font_size).toBe(12);
  expect(tn.text?.content).toBe('Handoff');
  const typo=h1.typography.find(t=>t.node===text)!;
  expect(typo.text.font_family).toBe('sans-serif');
  expect(h1.snippets.every(s=>s.state_revision===h1.state_revision)).toBe(true);
  const frameSnap=await doc.save();
  await doc.describeHandoff();
  expect(await doc.save()).toEqual(frameSnap);
  // state_revision advances on mutation, not on reads.
  const rev0=h1.state_revision;
  await doc.updateNode(frame,{name:'Card2'});
  expect((await doc.describeHandoff()).data.state_revision).toBe(rev0+1);
  // exportSlice: RGBA + manifest, subtree-scoped.
  const ex=(await doc.exportSlice(frame)).data;
  expect(ex.slice).toMatchObject({node:frame,kind:'frame',width:20,height:10,scale:1,format:'rgba8'});
  expect(ex.slice.box).toMatchObject({x:4,y:4,width:20,height:10});
  const b64=Buffer.from(ex.pixels_b64!,'base64');
  expect(b64.length).toBe(20*10*4);
  // Top-left pixel is the frame fill.
  expect([...b64.subarray(0,4)]).toEqual([200,100,50,255]);
  const manIds=ex.manifest.nodes.map(n=>n.id);
  expect(manIds).toContain(frame);expect(manIds).toContain(child);expect(manIds).toContain(text);
  expect(manIds).not.toContain(sibling);
  const cnode=ex.manifest.nodes.find(n=>n.id===child)!;
  expect(cnode).toMatchObject({x:1,y:1,parent:frame,depth:1});
  expect(ex.manifest.nodes_total).toBe(ex.manifest.nodes.length);
  expect(ex.manifest.nodes_truncated).toBe(false);
  // Scale multiplies the raster.
  const ex2=(await doc.exportSlice(frame,{scale:2})).data;
  expect(ex2.slice.width).toBe(40);expect(ex2.slice.height).toBe(20);
  expect(Buffer.from(ex2.pixels_b64!,'base64').length).toBe(40*20*4);
  // Reads leave the snapshot untouched; snapshot round-trips.
  const before=await doc.save();
  await doc.describeHandoff();await doc.exportSlice(frame);
  expect(await doc.save()).toEqual(before);
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  const h3=(await reopened.describeHandoff()).data;
  expect(h3.state_revision).toBeGreaterThanOrEqual(1);
  expect(h3.screens[0].node).toBe(frame);
  // Rejections are honest and atomic.
  const snap=await doc.save();
  await expect(doc.exportSlice(sibling)).rejects.toThrow();
  await expect(doc.exportSlice(text)).rejects.toThrow();
  await expect(doc.exportSlice(999999)).rejects.toThrow();
  expect(await doc.save()).toEqual(snap);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
