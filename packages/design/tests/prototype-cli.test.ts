import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('runs the prototype catalog through the real nf-cli engine: CRUD, graph, deterministic resolve, wrapper snapshot, undo',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const a=(await doc.addFrame(1,{name:'Screen A',width:10,height:10})).data.node_id;
  const b=(await doc.addFrame(1,{name:'Screen B',width:10,height:10})).data.node_id;
  await doc.definePrototypeScreen(a,{entry:true});
  await doc.definePrototypeScreen(b);
  const hot=(await doc.definePrototypeHotspot({screen:a,label:'Next',x:0.1,y:0.1,width:0.5,height:0.5})).data.id;
  await doc.definePrototypeTransition({id:'fade',label:'Fade',kind:'dissolve',duration_ms:200});
  const ix=(await doc.definePrototypeInteraction({hotspot:hot,trigger:'tap',action:'navigate',target:{kind:'screen',node:b},transition:'fade'})).data.id;
  const graph=(await doc.prototypeGraph()).data;
  expect(graph.screens.map(s=>s.node)).toEqual([a,b]);
  expect(graph.screens[0]).toMatchObject({entry:true,kind:'frame',name:'Screen A'});
  expect(graph.hotspots[0]).toMatchObject({id:hot,screen:a});
  expect(graph.interactions[0]).toMatchObject({id:ix,trigger:'tap',action:'navigate'});
  expect(graph.links).toEqual([{id:ix,source:a,target:b,label:'navigate'}]);
  // Deterministic resolution: identical payloads, host-owned scheduling.
  const q={hotspot:hot,trigger:'tap' as const};
  const r1=(await doc.resolvePrototypeEvent(q)).data;
  const r2=(await doc.resolvePrototypeEvent(q)).data;
  expect(r1).toEqual(r2);
  expect(r1).toMatchObject({matched:true,delay_ms:0,scheduled_by:'host'});
  expect(r1!.transition).toMatchObject({id:'fade',kind:'dissolve',duration_ms:200});
  expect((await doc.resolvePrototypeEvent({hotspot:hot,trigger:'hover'})).data).toBeNull();
  // Eventless reads leave the snapshot untouched.
  const before=await doc.save();
  await doc.prototypeGraph();await doc.resolvePrototypeEvent(q);
  expect(await doc.save()).toEqual(before);
  // Undo removes the interaction; redo restores it.
  await doc.undo();
  expect((await doc.prototypeGraph()).data.interactions).toHaveLength(0);
  await doc.redo();
  expect((await doc.prototypeGraph()).data.interactions).toHaveLength(1);
  // Rejections are atomic: bad geometry and unknown refs leave state intact.
  const snap=await doc.save();
  await expect(doc.definePrototypeHotspot({screen:a,label:'bad',x:0.9,y:0,width:0.5,height:0.5})).rejects.toThrow();
  await expect(doc.definePrototypeInteraction({hotspot:'nope',trigger:'tap',action:'back'})).rejects.toThrow();
  expect(await doc.save()).toEqual(snap);
  // Snapshot carries the schema:2 wrapper and reopens byte-identically.
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect((await reopened.prototypeGraph()).data.interactions).toHaveLength(1);
  // Cascade: removing screen A drops its hotspot and interaction.
  await reopened.removePrototypeScreen(a);
  const g2=(await reopened.prototypeGraph()).data;
  expect(g2.screens.map(s=>s.node)).toEqual([b]);
  expect(g2.hotspots).toHaveLength(0);
  expect(g2.interactions).toHaveLength(0);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
