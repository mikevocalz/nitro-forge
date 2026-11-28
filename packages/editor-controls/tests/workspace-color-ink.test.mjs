import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameThrottle} from '../src/frame-throttle.ts';
import {colorChanged,dialogKeyIntent,draftWithAlpha,revertDraft,comparisonContrast} from '../src/color/color-picker-dialog-model.ts';
import {appendPoint,createStrokeIdFactory,normalizePoint,strokeSegments,strokesUnderEraser,resolvePresenterInkKey,validatePresenterStrokes,trimLaserTrail} from '../src/slides/presenter-ink-model.ts';
test('frame previews coalesce and cancellation cannot leak a queued value',()=>{
 const callbacks=new Map();let next=0;const values=[];const throttle=createFrameThrottle(v=>values.push(v),{request:cb=>{callbacks.set(++next,cb);return next;},cancel:id=>callbacks.delete(id)});
 throttle.push(1);throttle.push(2);assert.equal(callbacks.size,1);callbacks.get(1)();assert.deepEqual(values,[2]);throttle.push(3);throttle.cancel();assert.equal(throttle.pending,false);assert.deepEqual(values,[2]);throttle.push(4);throttle.flush();assert.deepEqual(values,[2,4]);
});
test('dialog draft and Enter ownership preserve original until commit',()=>{
 const original={h:210,s:0.5,v:0.8,alpha:1},draft=draftWithAlpha(original,0.4);assert.equal(original.alpha,1);assert.equal(colorChanged(original,draft),true);assert.deepEqual(revertDraft(original),original);assert.equal(dialogKeyIntent('Enter','text-field'),'none');assert.equal(dialogKeyIntent('Enter','surface'),'commit');assert.ok(comparisonContrast(draft,original).ratio>=1);
});
test('presenter ink maps between slide sizes and erases using normalized geometry',()=>{
 const size={width:960,height:540};const p=normalizePoint(480,270,size);assert.deepEqual(p,{x:0.5,y:0.5});const points=appendPoint([p],normalizePoint(600,300,size),size);const stroke={id:'s',tool:'pen',color:'blue',size:'m',points};validatePresenterStrokes([stroke]);const a=strokeSegments(stroke,size),b=strokeSegments(stroke,{width:480,height:270});assert.equal(b[0].length,a[0].length/2);assert.deepEqual(strokesUnderEraser([stroke],p,size),['s']);assert.throws(()=>validatePresenterStrokes([stroke,stroke]),/Duplicate/);
});
test('presenter commands keep session undo and laser lifetime separate',()=>{
 assert.deepEqual(resolvePresenterInkKey({key:'z',ctrlKey:true}),{type:'remove-last'});assert.equal(resolvePresenterInkKey({key:'z',ctrlKey:true,shiftKey:true}),undefined);assert.deepEqual(resolvePresenterInkKey({key:'Escape'}),{type:'exit'});const make=createStrokeIdFactory(()=>123);assert.notEqual(make(),make());assert.equal(trimLaserTrail([{x:0,y:0,t:0},{x:0.5,y:0.5,t:900}],1000).length,1);
});
