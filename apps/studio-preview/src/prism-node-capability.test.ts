import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportsPrismNodeEditing} from './prism-node-capability.ts';

test('old and incomplete controls never activate node gestures',()=>{
 const complete={version:1,scopedInteractions:true,geometryCancellation:true,stableGeometryFocus:true};
 assert.equal(supportsPrismNodeEditing(Object.freeze(complete)),true);
 for(const value of [undefined,null,false,{}, {...complete,version:0},{...complete,version:2},{...complete,scopedInteractions:false},{...complete,geometryCancellation:false},{...complete,stableGeometryFocus:undefined}])
  assert.equal(supportsPrismNodeEditing(value),false);
});
