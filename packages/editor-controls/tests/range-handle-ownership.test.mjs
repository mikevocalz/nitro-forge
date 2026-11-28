import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrameScrubOwner} from '../src/timeline/frame-scrub-owner.ts';
function fixture(){const shown=[],previews=[],writes=[],restores=[];const owner=createFrameScrubOwner(v=>shown.push(v));const input={preview:v=>previews.push(v),restore:()=>restores.push(10),commit:v=>writes.push(v)};return{owner,input,shown,previews,writes,restores};}
test('existing value gesture commits one real adjustment and unchanged release does not write',()=>{const f=fixture();f.owner.admit('a');f.owner.begin('a',10,f.input);f.owner.move('a',12);f.owner.release('a');f.owner.release('a');assert.deepEqual(f.previews,[12]);assert.deepEqual(f.writes,[12]);f.owner.begin('a',10,f.input);f.owner.release('a');assert.deepEqual(f.writes,[12]);});
test('geometry/source/admission replacement restores original preview host and suppresses late input',()=>{const f=fixture();f.owner.admit('a');f.owner.begin('a',10,f.input);f.owner.move('a',12);f.owner.admit('b');f.owner.move('a',40);f.owner.release('a');f.owner.release('b');assert.deepEqual(f.previews,[12]);assert.deepEqual(f.restores,[10]);assert.deepEqual(f.writes,[]);assert.equal(f.shown.at(-1),undefined);});
test('unmount and cancellation restore original host; reentrant restoration cannot resurrect obsolete grant',()=>{const f=fixture();f.owner.admit('a');f.owner.begin('a',10,{...f.input,restore:()=>{f.owner.admit('b');f.owner.begin('b',20,{...f.input,commit:v=>f.writes.push(v+100)});}});f.owner.begin('a',10,f.input);f.owner.move('a',12);f.owner.release('a');f.owner.move('b',22);f.owner.release('b');assert.deepEqual(f.writes,[122]);f.owner.begin('b',10,f.input);f.owner.move('b',11);f.owner.invalidate();f.owner.release('b');assert.deepEqual(f.restores,[10]);});
test('throwing original restoration consumes old session before failure',()=>{const f=fixture();f.owner.admit('a');f.owner.begin('a',10,{...f.input,restore:()=>{throw Error('restore')}});f.owner.move('a',12);assert.throws(()=>f.owner.admit('b'),/restore/);f.owner.release('b');assert.deepEqual(f.writes,[]);assert.equal(f.shown.at(-1),undefined);});
test('both range bodies retain identity and opt into existing frame scrub ownership',()=>{for(const name of ['LoopRangeBar','InOutRangeHandles']){const source=readFileSync(new URL(`../src/timeline/${name}.tsx`,import.meta.url),'utf8');assert.doesNotMatch(source,new RegExp(`<${name}Body\\s+[^>]*\\bkey=`));assert.match(source,/useEditorBoundary\(\[signature\]\)/);assert.match(source,/useFrameScrub\(\{frame,disabled,boundary,onRestore:/);assert.match(source,/if\(!admitted\(\)\)return/);}});

test('queued old begin cannot cancel a new admitted gesture',()=>{const f=fixture();f.owner.admit('b');f.owner.begin('b',20,f.input);f.owner.begin('a',10,f.input);f.owner.move('b',22);f.owner.release('b');assert.deepEqual(f.writes,[22]);assert.deepEqual(f.restores,[]);});
test('synchronous preview-store admission suppresses stale outward callbacks',()=>{
 let owner;let replace=false;const previews=[],writes=[];
 owner=createFrameScrubOwner(()=>{if(replace){replace=false;owner.admit('b');}});
 const input={preview:v=>previews.push(v),restore:()=>{},commit:v=>writes.push(v)};
 owner.admit('a');owner.begin('a',10,input);replace=true;owner.move('a',12);assert.deepEqual(previews,[]);
 owner.admit('c');owner.begin('c',10,input);owner.move('c',12);replace=true;owner.release('c');assert.deepEqual(writes,[]);
});

test('same-boundary reentrant grant reports obsolete outer begin as unaccepted',()=>{const f=fixture();f.owner.admit('a');f.owner.begin('a',10,{...f.input,restore:()=>{f.owner.begin('a',20,f.input);}});assert.equal(f.owner.begin('a',10,f.input),false);f.owner.move('a',22);f.owner.release('a');assert.deepEqual(f.writes,[22]);});

test('unchanged external boundary disable cancels mid-drag, consumes release and re-enables fresh gestures',()=>{
 const f=fixture();const external='constant-source';f.owner.admit(external,false);
 f.owner.begin(external,10,f.input);f.owner.move(external,12);f.owner.admit(external,true);
 f.owner.move(external,14);f.owner.release(external);assert.deepEqual(f.previews,[12]);assert.deepEqual(f.restores,[10]);assert.deepEqual(f.writes,[]);
 assert.equal(f.owner.begin(external,10,f.input),false);
 f.owner.admit(external,false);f.owner.release(external);assert.deepEqual(f.writes,[]);
 assert.equal(f.owner.begin(external,20,f.input),true);f.owner.move(external,22);f.owner.release(external);assert.deepEqual(f.writes,[22]);
 const hook=readFileSync(new URL('../src/timeline/useFrameScrub.ts',import.meta.url),'utf8');
 assert.match(hook,/useEditorBoundary\(\[boundary,disabled\]\)/);
 assert.match(hook,/owner.admit\(ownership,disabled\)/);
 assert.match(hook,/owner.release\(ownership\)/);
});
