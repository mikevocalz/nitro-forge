import test from 'node:test';
import assert from 'node:assert/strict';
import {sizingFields,sizingCommit} from '../src/design/HugFillFixedSizeControls.model.ts';

const fixed={mode:'fixed',value:100,canHug:true,canFill:true};
test('preserves default bounds and permits the actual host dimension range',()=>{
 const fields=sizingFields(fixed,{...fixed,max:10000000,step:.5});
 assert.equal(fields[1].min,.001);assert.equal(fields[1].max,1000000);assert.equal(fields[1].step,1);
 assert.equal(fields[3].max,10000000);assert.equal(fields[3].step,.5);
 const hug={...fixed,mode:'hug',value:2000000,max:10000000};
 assert.equal(sizingCommit(hug,fixed,'x:mode','fixed').value.value,2000000);
 assert.equal(sizingCommit(fixed,{...fixed,max:10000000},'y:value',2000000).value.value,2000000);
 assert.deepEqual(fixed,{mode:'fixed',value:100,canHug:true,canFill:true});
});
test('rejects invalid bounds and writes without silently clamping or changing modes',()=>{
 for(const change of [{min:0},{max:NaN},{max:Infinity},{min:5,max:4},{step:0},{step:NaN}])
  assert.throws(()=>sizingFields({...fixed,...change},fixed),RangeError);
 for(const value of [NaN,Infinity,0,1000001,'5'])assert.throws(()=>sizingCommit(fixed,fixed,'x:value',value),RangeError);
 assert.throws(()=>sizingCommit({...fixed,mode:'hug'},fixed,'x:value',5),/Only fixed/);
 assert.throws(()=>sizingCommit({...fixed,mode:'hug',value:2000000},fixed,'x:mode','fixed'),RangeError);
});
test('retains authoritative axis, capability and disabled state at commit',()=>{
 assert.throws(()=>sizingCommit(fixed,fixed,'z:value',5),/Unknown/);
 assert.throws(()=>sizingCommit(fixed,fixed,'x:value\n',5),/Unknown/);
 assert.throws(()=>sizingCommit(fixed,fixed,'x:mode','other'),/Unknown/);
 assert.throws(()=>sizingCommit({...fixed,canHug:false},fixed,'x:mode','hug'),/unavailable/);
 assert.throws(()=>sizingCommit(fixed,{...fixed,unavailableReason:'Locked'},'y:value',5),/Locked/);
 assert.throws(()=>sizingCommit({...fixed,unavailableReason:''},fixed,'x:value',5),/unavailable/);
 const result=sizingCommit(fixed,{...fixed,canFill:false,min:.5,max:200,step:.5},'y:value',12.5);
 assert.equal(result.axis,'y');assert.equal(result.value.canFill,false);assert.equal(result.value.max,200);assert.equal(result.value.value,12.5);
});
