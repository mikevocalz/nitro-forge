import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAlphaModes,layerBlendProblem,layerOpacityFromPercent,validateLayerBlend} from '../src/layers/layer-blend-model.ts';
const modes=[{id:'normal',label:'Normal'},{id:'multiply',label:'Multiply'},{id:'legacy',label:'Legacy',unavailableReason:'Unsupported by compositor'}],spaces=[{id:'linear',label:'Linear sRGB',transfer:'linear',modeIds:['normal','multiply','legacy']},{id:'encoded',label:'Encoded sRGB',transfer:'encoded',modeIds:['normal']}],value={mode:'normal',opacity:.123456,spaceId:'linear',alphaMode:'straight'};
test('precise alpha preserves six decimals from percent entry, including transparent and opaque endpoints',()=>{assert.equal(layerOpacityFromPercent(12.3456),.123456);assert.equal(layerOpacityFromPercent(0),0);assert.equal(layerOpacityFromPercent(100),1);for(const n of [-1,101,NaN,Infinity])assert.throws(()=>layerOpacityFromPercent(n));});
test('spaces and mode capabilities remain explicit and unsupported retained values explain themselves',()=>{assert.equal(layerBlendProblem(value,modes,spaces),undefined);assert.match(layerBlendProblem({...value,mode:'multiply',spaceId:'encoded'},modes,spaces),/unavailable/);assert.equal(layerBlendProblem({...value,mode:'legacy'},modes,spaces),'Unsupported by compositor');assert.equal(layerBlendProblem(value,modes,[{...spaces[0],unavailableReason:'Profile not loaded'},spaces[1]]),'Profile not loaded');});
test('invalid alpha, ambiguous catalogs, unknown policies and mode references are rejected',()=>{for(const bad of [{...value,opacity:2},{...value,alphaMode:'unknown'},{...value,mode:'missing'},{...value,spaceId:'missing'}])assert.throws(()=>validateLayerBlend(bad,modes,spaces));assert.throws(()=>validateLayerBlend(value,[...modes,modes[0]],spaces));assert.throws(()=>validateLayerBlend(value,modes,[...spaces,spaces[0]]));assert.throws(()=>validateLayerBlend(value,modes,[{...spaces[0],modeIds:['missing']} ]));});
test('alpha catalogs are optional, checked like modes and spaces, and hold the current value',()=>{
 const straightOnly=[{id:'straight',label:'Straight alpha'}],premultipliedOff=[...straightOnly,{id:'premultiplied',label:'Premultiplied alpha',unavailableReason:'Straight alpha only'}];
 assert.deepEqual(defaultAlphaModes.map(alpha=>[alpha.id,alpha.label,alpha.unavailableReason]),[['straight','Straight alpha',undefined],['premultiplied','Premultiplied alpha',undefined]]);
 for(const catalog of [undefined,defaultAlphaModes,straightOnly,premultipliedOff])assert.doesNotThrow(()=>validateLayerBlend(value,modes,spaces,catalog));
 assert.throws(()=>validateLayerBlend({...value,alphaMode:'premultiplied'},modes,spaces,straightOnly),/alpha catalog/);
 for(const bad of [[],[...premultipliedOff,straightOnly[0]],[straightOnly[0],straightOnly[0]],[{id:'linear',label:'Linear'}],[{id:'straight',label:''}],[{id:'straight',label:'Straight',unavailableReason:' '}],[{id:'straight',label:'Straight',unavailableReason:'x'.repeat(1025)}],[{id:'straight',label:'Straight',unavailableReason:null}],[null],[,],null,'straight',{length:1,0:{id:'straight',label:'Straight'}}])assert.throws(()=>validateLayerBlend(value,modes,spaces,bad),RangeError);
});
test('the current alpha reason is reported after blend-mode and space reasons',()=>{
 const premultipliedOff=[{id:'straight',label:'Straight alpha'},{id:'premultiplied',label:'Premultiplied alpha',unavailableReason:'Straight alpha only'}],premulValue={...value,alphaMode:'premultiplied'};
 assert.equal(layerBlendProblem(value,modes,spaces,premultipliedOff),undefined);
 assert.equal(layerBlendProblem(premulValue,modes,spaces,premultipliedOff),'Straight alpha only');
 assert.equal(layerBlendProblem({...premulValue,mode:'legacy'},modes,spaces,premultipliedOff),'Unsupported by compositor');
 assert.equal(layerBlendProblem(premulValue,modes,spaces),undefined,'without a catalog alpha never reports a problem, as in rc.1');
});
