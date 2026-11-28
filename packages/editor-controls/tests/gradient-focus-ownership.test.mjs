import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGradientPreviewOwner} from '../src/vector/gradient-preview-owner.ts';
test('geometry/source/admission cancellation clears only the preview host that owns it',()=>{
 const owner=createGradientPreviewOwner();const old=[],current=[];
 owner.publish('document:1:width200',v=>old.push(v),'old geometry');
 owner.clear('document:1:width200');
 assert.deepEqual(old,['old geometry',undefined]);
 owner.publish('document:2:width300',v=>current.push(v),'new geometry');
 owner.clear('document:1:width200');
 assert.deepEqual(current,['new geometry']);
 owner.clear('document:2:width300');owner.clear();
 assert.deepEqual(current,['new geometry',undefined]);
});
test('changing preview callback ownership cancels the previous lease before delivering new pixels',()=>{
 const owner=createGradientPreviewOwner();const calls=[];
 owner.publish('same',v=>calls.push(['old',v]),'a');
 owner.publish('same',v=>calls.push(['new',v]),'b');owner.clear();
 assert.deepEqual(calls,[['old','a'],['old',undefined],['new','b'],['new',undefined]]);
});
test('both gradient layers retain mounted identity across resize, source updates and disable',()=>{
 const shared=readFileSync(new URL('../src/vector/GradientOnCanvasHandles.tsx',import.meta.url),'utf8');
 const photo=readFileSync(new URL('../src/photo/LinearRadialGradientMask.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(shared,/<GradientOnCanvasHandlesBody\s+[^>]*\bkey=/);
 assert.doesNotMatch(photo,/<GradientOnCanvasHandles\s+[^>]*\bkey=/);
 assert.doesNotMatch(photo,/disabled\s*\?\s*<View/);
 assert.match(photo,/disabledReason=\{disabled\?/);
 assert.match(shared,/gestureBoundary=\{owner\}/);
 assert.match(shared,/\[gestureBoundary,paint,transform,width,height,disabledReason,busy\]/);
 assert.match(shared,/drag.current=null;pressAt.current=null;clearPreview\(\)/);
 assert.match(shared,/const release=\(\)=>\{\s*if\(!admitted\(\)\)return;\s*const d=drag.current;\s*drag.current=null;\s*if\(!d\|\|d.cancelled\|\|disabledReason!==undefined\|\|busy\)return;/);
 assert.match(shared,/if\(!start\|\|Math.hypot/);
});

test('queued semantic handle and stop actions reject changed geometry before access',async()=>{
 const {gradientTargetCurrent}=await import('../src/vector/gradient-target-owner.ts');
 const paint={type:'linear',x0:0,y0:0,x1:10,y1:0,stops:[{offset:0,color:[0,0,0,255]},{offset:1,color:[255,255,255,255]}]};
 assert.equal(gradientTargetCurrent('new','new',false,paint,{kind:'handle',handle:'radius'}),false);
 assert.equal(gradientTargetCurrent('old','new',false,paint,{kind:'stop',index:0}),false);
 assert.equal(gradientTargetCurrent('new','new',true,paint,{kind:'handle',handle:'start'}),false);
 assert.equal(gradientTargetCurrent('new','new',false,paint,{kind:'stop',index:2}),false);
 assert.equal(gradientTargetCurrent('new','new',false,paint,{kind:'handle',handle:'start'}),true);
 assert.equal(gradientTargetCurrent('new','new',false,paint,{kind:'stop',index:1}),true);
});

test('reentrant restoration publishing a newer owner prevents stale replacement notification',()=>{
 const owner=createGradientPreviewOwner();const calls=[];
 const newer=v=>calls.push(['newer',v]);
 owner.publish('old',v=>{calls.push(['old',v]);if(v===undefined)owner.publish('newer',newer,'authoritative');},'initial');
 owner.publish('stale',v=>calls.push(['stale',v]),'obsolete');
 assert.deepEqual(calls,[['old','initial'],['old',undefined],['newer','authoritative']]);
 owner.clear('stale');assert.equal(calls.length,3);
 owner.clear('newer');assert.deepEqual(calls.at(-1),['newer',undefined]);
});
test('reentrant restoration clear wins even while the previous lease is already detached',()=>{
 const owner=createGradientPreviewOwner();const calls=[];
 owner.publish('old',v=>{calls.push(['old',v]);if(v===undefined)owner.clear();},'initial');
 owner.publish('stale',v=>calls.push(['stale',v]),'obsolete');owner.clear();
 assert.deepEqual(calls,[['old','initial'],['old',undefined]]);
});
