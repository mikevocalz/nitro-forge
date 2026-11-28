import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGraphRequests,currentGraphOutput,graphDragPoint,graphInteractionBoundary,graphDisplayedNodes} from '../src/graph/patch-interaction-model.ts';
const nodes=[{id:'a',title:'A',x:1,y:2,inputs:[],outputs:[{id:'out',label:'Out',dataType:'audio'}]}];
test('rejected callbacks are consumed and only current request can surface an error',async()=>{
 const owner=createGraphRequests(),errors=[];
 assert.equal(await owner.run(()=>Promise.reject(new Error('Host rejected move')),s=>errors.push(s)),false);
 assert.deepEqual(errors,['Host rejected move']);
 let fail;const old=owner.run(()=>new Promise((_,reject)=>{fail=reject;}),s=>errors.push(s));
 assert.equal(await owner.run(()=>undefined,s=>errors.push(s)),true);fail(new Error('late stale error'));
 assert.equal(await old,false);assert.deepEqual(errors,['Host rejected move']);
 assert.equal(await owner.run(()=>false,s=>errors.push(s)),false);
});
test('geometry admission and unmount boundaries suppress old async outcomes',async()=>{
 const owner=createGraphRequests(),errors=[];let finish;
 const pending=owner.run(()=>new Promise(resolve=>{finish=resolve;}),s=>errors.push(s));owner.invalidate();finish(true);assert.equal(await pending,false);
 let fail;const pendingError=owner.run(()=>new Promise((_,reject)=>{fail=reject;}),s=>errors.push(s));owner.deactivate();fail(new Error('closed document'));assert.equal(await pendingError,false);assert.deepEqual(errors,[]);
});
test('authoritative geometry mismatch discards previews and dangling selected output',()=>{
 const boundary=graphInteractionBoundary('doc1',nodes,[],100,100,1,false);
 assert.equal(graphDisplayedNodes(nodes,{a:{x:9,y:10}},boundary,boundary)[0].x,9);
 const next=[{...nodes[0],x:4}];const changed=graphInteractionBoundary('doc1',next,[],100,100,1,false);
 assert.equal(graphDisplayedNodes(next,{a:{x:9,y:10}},boundary,changed)[0].x,4);
 // Release has no optimistic cache, even when host rejects without new props.
 assert.equal(graphDisplayedNodes(nodes,{},boundary,boundary)[0].x,1);
 const output={nodeId:'a',portId:'out',dataType:'audio'};
 assert.deepEqual(currentGraphOutput(nodes,output),output);assert.equal(currentGraphOutput([],output),null);assert.equal(currentGraphOutput([{...nodes[0],outputs:[{...nodes[0].outputs[0],dataType:'control'}]}],output),null);
});
test('drag math uses admitted scale and transform geometry changes invalidate without key remounts',()=>{
 assert.deepEqual(graphDragPoint({x:5,y:7},10,-30,2),{x:10,y:0});
 const base=graphInteractionBoundary('scope',nodes,[],100,100,1,false);
 for(const [width,height,scale,disabled] of [[200,100,1,false],[100,200,1,false],[100,100,2,false],[100,100,1,true]])assert.notEqual(graphInteractionBoundary('scope',nodes,[],width,height,scale,disabled),base);
 for(const file of ['cad/NodeGraphCanvas.tsx','motion/NodeGraphEditor.tsx']){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/<PatchGraph\s+key=/);assert.match(source,/interactionBoundary[=:]/);
 }
 const source=readFileSync(new URL('../src/graph/PatchGraph.tsx',import.meta.url),'utf8');assert.match(source,/<PatchNode key=\{node.id\}/);assert.match(source,/admitted.current!==latest.current.boundary/);
});
