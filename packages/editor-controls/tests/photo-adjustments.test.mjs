import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPhotoDevelop,parsePhotoDevelop,serializePhotoDevelop,validatePhotoDevelop,validatePhotoRating} from '../src/photo/photo-adjustments.ts';

test('photo settings round-trip full precision and independent bands without originals',()=>{
 const settings=defaultPhotoDevelop();settings.exposure.exposure=1.23456789;settings.mixer.red.hue=-12.34;settings.lens.profileId='camera/lens v2';
 const decoded=parsePhotoDevelop(serializePhotoDevelop(settings));assert.deepEqual(decoded,settings);assert.notEqual(decoded,settings);assert.equal(decoded.mixer.blue.hue,0);assert.equal(defaultPhotoDevelop().mixer.red.hue,0);
});
test('unsupported, oversized and malformed photo interchange fails before application',()=>{
 for(const value of [null,[],{}, {...defaultPhotoDevelop(),version:2}, {...defaultPhotoDevelop(),exposure:{...defaultPhotoDevelop().exposure,temperature:0}}, {...defaultPhotoDevelop(),mixer:{red:{hue:0,saturation:0,luminance:0}}}])assert.throws(()=>parsePhotoDevelop(JSON.stringify(value)));
 assert.throws(()=>parsePhotoDevelop(' '.repeat(65537)),/64 KiB/);assert.throws(()=>parsePhotoDevelop('{invalid'));
 const settings=defaultPhotoDevelop();settings.tone.clarity=Infinity;assert.throws(()=>validatePhotoDevelop(settings));
});
test('normalization excludes unknown fields and prototype keys',()=>{
 const text=serializePhotoDevelop(defaultPhotoDevelop());const payload=JSON.parse(text);payload.originalPixels='not settings';Object.defineProperty(payload,'__proto__',{value:{polluted:true},enumerable:true});payload.exposure.unknown=10;
 const normalized=JSON.parse(serializePhotoDevelop(parsePhotoDevelop(JSON.stringify(payload))));assert.equal(normalized.originalPixels,undefined);assert.equal(normalized.exposure.unknown,undefined);assert.equal({}.polluted,undefined);
});
test('ratings have bounded integer stars and mutually exclusive pick/reject values',()=>{
 for(const flag of ['none','pick','reject'])validatePhotoRating({stars:5,label:'purple',flag});
 for(const stars of [-1,6,2.5,NaN])assert.throws(()=>validatePhotoRating({stars,label:'none',flag:'none'}));
 assert.throws(()=>validatePhotoRating({stars:0,label:'orange',flag:'none'}));assert.throws(()=>validatePhotoRating({stars:0,label:'none',flag:['pick','reject']}));
});
