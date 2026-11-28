import test from "node:test";
import assert from "node:assert/strict";
import { commitCellEdit, selectCellAfterCommit } from "../src/cell-commit.ts";

function harness() {
  let state = {draft:"=SUM(A1:A3)", dirty:true, pending:false, editVersion:1, error:null};
  return {read:()=>state, write:patch=>{state={...state,...patch};}};
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
test("tapping another cell saves the dirty formula before changing selection", async()=>{
  const h=harness(), task=deferred(); let selection="A1";
  const next=selectCellAfterCommit(h.read,
    ()=>commitCellEdit("A1",()=>task.promise,h.read,h.write),()=>{selection="B1";});
  assert.equal(selection,"A1");
  task.resolve(); assert.equal(await next,true);
  assert.equal(selection,"B1");
});
test("failed save or newer edit prevents a cell tap from discarding the draft", async()=>{
  for(const newer of [false,true]){
    const h=harness(), task=deferred(); let selections=0;
    const next=selectCellAfterCommit(h.read,
      ()=>commitCellEdit("A1",()=>task.promise,h.read,h.write),()=>{selections++;});
    if(newer){h.write({editVersion:2,draft:"newer"});task.resolve();}
    else task.reject(new Error("Offline"));
    assert.equal(await next,false);
    assert.equal(selections,0);
    assert.equal(h.read().dirty,true);
  }
});
test("submit followed by blur sends exactly one commit before React rerenders", async()=>{
  const h=harness(), task=deferred();
  const calls=[];
  const commit=(...args)=>{calls.push(args);return task.promise;};
  const first=commitCellEdit("B1",commit,h.read,h.write);
  await commitCellEdit("B1",commit,h.read,h.write);
  assert.deepEqual(calls,[["B1","=SUM(A1:A3)"]]);
  task.resolve(); await first;
  assert.equal(h.read().dirty,false);
  assert.equal(h.read().pending,false);
});
test("an old save cannot clear a newer draft or sheet selection", async()=>{
  const h=harness(), task=deferred();
  const first=commitCellEdit("B1",()=>task.promise,h.read,h.write);
  h.write({draft:"new sheet draft",dirty:true,editVersion:2});
  task.resolve(); await first;
  assert.equal(h.read().dirty,true);
  assert.equal(h.read().draft,"new sheet draft");
});
test("a rejected old save cannot attach errors to the next edit", async()=>{
  const h=harness(), task=deferred();
  const first=commitCellEdit("B1",()=>task.promise,h.read,h.write);
  h.write({draft:"next",editVersion:2});
  task.reject(new Error("Old sheet failed")); await first;
  assert.equal(h.read().error,null);
  assert.equal(h.read().pending,false);
});
test("current save failure retains the draft and permits retry", async()=>{
  const h=harness();
  await commitCellEdit("B1",()=>{throw new Error("Offline");},h.read,h.write);
  assert.equal(h.read().error,"Offline");
  assert.equal(h.read().dirty,true);
  await commitCellEdit("B1",()=>{},h.read,h.write);
  assert.equal(h.read().error,null);
  assert.equal(h.read().dirty,false);
});
test("missing selection, read-only and clean edits never invoke persistence", async()=>{
  const h=harness(); let calls=0;
  const commit=()=>{calls++;};
  await commitCellEdit("",commit,h.read,h.write);
  await commitCellEdit("A1",undefined,h.read,h.write);
  h.write({dirty:false});
  await commitCellEdit("A1",commit,h.read,h.write);
  assert.equal(calls,0);
});
