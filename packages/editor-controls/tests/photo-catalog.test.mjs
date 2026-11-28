import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPhotoCatalogFilter,validPhotoDate,validateCatalogFilter,validateCatalogChoices,validatePhotoCatalog,togglePhotoSelection} from '../src/photo/photo-catalog.ts';
test('calendar filters reject normalization, reversed dates and invalid EXIF ranges',()=>{
 assert.equal(validPhotoDate('2024-02-29'),true);for(const date of ['2023-02-29','2026-13-01','2026-04-31','11/06/2026'])assert.equal(validPhotoDate(date),false);
 const value=emptyPhotoCatalogFilter();validateCatalogFilter(value);validateCatalogFilter({...value,dateFrom:'2026-11-01',dateTo:'2026-11-06',iso:[100,3200],shutterSeconds:[1/8000,30]});
 for(const filter of [{...value,dateFrom:'2026-11-06',dateTo:'2026-11-01'},{...value,iso:[400,100]},{...value,aperture:[0,2]},{...value,shutterSeconds:[1,Infinity]},{...value,minimumStars:2.5},{...value,query:'x'.repeat(257)}])assert.throws(()=>validateCatalogFilter(filter));
});
test('catalog pages keep off-page selection and reject duplicate identity',()=>{
 const item={id:'visible',name:'Harbor',thumbnailUri:null,rating:{stars:4,label:'blue',flag:'pick'}};
 validatePhotoCatalog([item],['other-page']);assert.deepEqual(togglePhotoSelection(['other-page'],'visible'),['other-page','visible']);assert.deepEqual(togglePhotoSelection(['other-page','visible'],'visible'),['other-page']);assert.throws(()=>validatePhotoCatalog([item,item],[]));assert.throws(()=>validatePhotoCatalog([item],['visible','visible']));assert.throws(()=>validateCatalogChoices([{id:'x',label:'A'},{id:'x',label:'B'}]));
});

test('metadata preserves raw capture labels and rejects invalid measurement/provenance',async()=>{
 const {validatePhotoMetadata}=await import('../src/photo/photo-metadata.ts');
 const value={photoId:'a',revision:1,fileName:'Original.dng',mimeType:null,dimensions:{width:6000,height:4000},cameraMaker:null,cameraModel:null,lens:null,capturedAt:'2026:11:06 09:10:00-05:00',exposureSeconds:1/125,aperture:2.8,iso:100,focalLengthMm:50,provenance:[{id:'source',label:'Original',value:'Retained'}]};
 validatePhotoMetadata(value);assert.equal(value.capturedAt,'2026:11:06 09:10:00-05:00');assert.throws(()=>validatePhotoMetadata({...value,exposureSeconds:0}));assert.throws(()=>validatePhotoMetadata({...value,dimensions:{width:Infinity,height:1}}));assert.throws(()=>validatePhotoMetadata({...value,provenance:[value.provenance[0],value.provenance[0]]}));
});
