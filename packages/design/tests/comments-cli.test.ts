import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DesignDocument} from '../src/index';

it('runs comment threads through the real nf-cli engine: CRUD, resolve, undo, schema:2 snapshot, hostile-safe reads',async()=>{
 const host=new CliHost();let doc:DesignDocument|undefined,reopened:DesignDocument|undefined;
 try{
  doc=await DesignDocument.open(host,{width:20,height:10});
  const auto=(await doc.defineCommentThread({anchor:{x:1.5,y:2.5},body:'Auto id'})).data.id;
  expect(auto).toBe('comment-1');
  const pinned=(await doc.defineCommentThread({anchor:{x:12.5,y:-3},body:'Please widen this',author:'Ada',time_label:'2 hours ago'})).data.id;
  const reply=(await doc.addCommentReply(pinned,{body:'Done',author:'Bo'})).data.id;
  expect(reply).toBe('reply-1');
  const listed=(await doc.listComments()).data.threads!;
  expect(listed).toHaveLength(2);
  expect(listed[1]).toMatchObject({id:pinned,anchor:{x:12.5,y:-3},body:'Please widen this',author:'Ada'});
  // `resolved:false` is omitted on the wire; absent means open.
  expect(listed[1]!.resolved).toBeUndefined();
  expect(listed[1]!.replies).toHaveLength(1);
  // Pins are document-space points: node edits and removal never move or
  // orphan them (no node anchor exists in the contract).
  const frame=(await doc.addFrame(1,{name:'F',x:0,y:0,width:5,height:5})).data.node_id;
  await doc.updateNode(frame,{x:9,y:9});
  await doc.removeNode(frame);
  expect((await doc.listComments()).data.threads![1]!.anchor).toEqual({x:12.5,y:-3});
  // Resolve/reopen are journaled; equal writes are silent.
  await doc.setCommentResolved(pinned,true);
  expect((await doc.listComments()).data.threads![1]!.resolved).toBe(true);
  await doc.setCommentResolved(pinned,false);
  expect((await doc.listComments()).data.threads![1]!.resolved).toBeUndefined();
  // Atomic rejections leave state intact.
  const snap=await doc.save();
  await expect(doc.defineCommentThread({anchor:{x:2e6,y:0},body:'bad'})).rejects.toThrow();
  await expect(doc.defineCommentThread({anchor:{x:0,y:0},body:''})).rejects.toThrow();
  await expect(doc.addCommentReply('missing',{body:'x'})).rejects.toThrow();
  await expect(doc.removeCommentThread('missing')).rejects.toThrow();
  expect(await doc.save()).toEqual(snap);
  // Undo removes the last reply; redo restores it.
  await doc.addCommentReply(pinned,{body:'second'});
  expect((await doc.listComments()).data.threads![1]!.replies).toHaveLength(2);
  await doc.undo();
  expect((await doc.listComments()).data.threads![1]!.replies).toHaveLength(1);
  await doc.redo();
  expect((await doc.listComments()).data.threads![1]!.replies).toHaveLength(2);
  // Snapshot carries the schema:2 wrapper and reopens byte-identically.
  const bytes=await doc.save();
  reopened=await DesignDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  expect((await reopened.listComments()).data.threads).toHaveLength(2);
  // Removing the last thread returns snapshots to bare schema:1.
  await reopened.removeCommentThread(auto);
  await reopened.removeCommentThread(pinned);
  const bare=await reopened.save();
  const text=new TextDecoder().decode(bare);
  expect(text).not.toContain('"comments"');
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
