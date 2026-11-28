import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfiles,validateColorChannels,validateGamutReport,validateNamedColor,validateSoftProof,validatePrintColor} from '../src/color/color-management.ts';
const profiles=[{id:'icc:press',label:'Press',model:'cmyk'},{id:'icc:p3',label:'Display P3',model:'rgb'}];
test('profiles preserve identity and reject ambiguous or unbounded choices',()=>{
 validateProfiles(profiles);assert.throws(()=>validateProfiles([...profiles,profiles[0]]),/distinct/);assert.throws(()=>validateProfiles([{...profiles[0],model:'guess'}]),/known/);
});
test('CMYK percentages retain profile and alpha; HDR channels retain negative and above-one values',()=>{
 const print={profileId:'icc:press',channels:[0,25.5,80,100],alpha:.75};validateColorChannels(print,4,0,100);assert.deepEqual(print.channels,[0,25.5,80,100]);
 validateColorChannels({profileId:'linear:p3',channels:[-.2,4,1.25],alpha:1},3,-16,16);
 assert.throws(()=>validateColorChannels({...print,channels:[0,101,0,0]},4,0,100),RangeError);
 assert.throws(()=>validateColorChannels({...print,profileId:''},4,0,100),/profile/);
 assert.throws(()=>validateColorChannels({...print,alpha:NaN},4,0,100),RangeError);
 assert.throws(()=>validateColorChannels(print,4,1,1),RangeError);
});
test('gamut status requires actual measured counts and finite delta E',()=>{
 validateGamutReport({sourceProfileId:'p3',destinationProfileId:'press',outside:25,total:100,maximumDeltaE:3.4});
 for(const change of [{outside:101},{outside:-1},{total:.5},{maximumDeltaE:NaN}])assert.throws(()=>validateGamutReport({sourceProfileId:'p3',destinationProfileId:'press',outside:0,total:100,...change}),RangeError);
});
test('named spot/global colors validate identity without inventing ink conversions',()=>{
 const color={id:'ink1',name:'Brand cyan',kind:'spot',tint:75,alternate:{r:0,g:180,b:220,alpha:1}};validateNamedColor(color);
 assert.throws(()=>validateNamedColor({...color,name:' '}),TypeError);assert.throws(()=>validateNamedColor({...color,tint:101}),RangeError);
});
test('proof settings require an available profile before enabling; every intent is explicit',()=>{
 const proof={enabled:false,profileId:null,intent:'relative-colorimetric',blackPointCompensation:true,simulatePaper:false,simulateBlackInk:false};validateSoftProof(proof,profiles);
 assert.throws(()=>validateSoftProof({...proof,enabled:true},profiles),/Choose/);
 assert.throws(()=>validateSoftProof({...proof,profileId:'missing'},profiles),/Unknown/);
 assert.throws(()=>validateSoftProof({...proof,intent:'guess'},profiles),/intent/);
 validateSoftProof({...proof,enabled:true,profileId:'icc:press'},profiles);
});

test('Lab entry retains signed profile channels and explicit chroma bounds',()=>{
 const lab={model:'lab',profileId:'icc:lab',channels:[50,-45,80],alpha:.5};validatePrintColor(lab);assert.throws(()=>validatePrintColor({...lab,channels:[101,0,0]}),RangeError);assert.throws(()=>validatePrintColor({...lab,channels:[50,-129,0]}),RangeError);validatePrintColor({...lab,channels:[50,-150,150]},[-160,160]);
});
test('gamut comparison keeps original HDR values distinct from mapped display preview',()=>{
 const color={profileId:'p3',channels:[-.2,2,.5],alpha:1,preview:{r:0,g:255,b:128,alpha:1}};
 validateGamutReport({sourceProfileId:'p3',destinationProfileId:'press',outside:1,total:1,comparison:{original:color,mapped:{...color,profileId:'press',channels:[0,1,.5]}}});
 assert.throws(()=>validateGamutReport({sourceProfileId:'p3',destinationProfileId:'press',outside:1,total:1,comparison:{original:color,mapped:color}}),/profiles/);
});
