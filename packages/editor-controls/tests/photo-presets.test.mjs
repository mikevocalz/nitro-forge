import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPhotoDevelop} from '../src/photo/photo-adjustments.ts';
import {parsePhotoPreset,serializePhotoPreset,validatePhotoTargets,validatePhotoPresets} from '../src/photo/photo-presets.ts';
import {defaultPhotoBatchExport,validatePhotoExport,validatePhotoExportProgress} from '../src/photo/photo-export.ts';
test('versioned presets retain settings and reject unknown schema or duplicate identity',()=>{
 const preset={version:1,id:'warm',name:'Warm',settings:defaultPhotoDevelop()};assert.deepEqual(parsePhotoPreset(serializePhotoPreset(preset)),preset);for(const value of [{...preset,version:2},{...preset,settings:{}},{...preset,name:' '}])assert.throws(()=>parsePhotoPreset(JSON.stringify(value)));assert.throws(()=>parsePhotoPreset('x'.repeat(131073)));assert.throws(()=>validatePhotoPresets([preset,preset]));
});
test('batch targets and export configuration preserve explicit metadata privacy',()=>{
 const formats=[{id:'jpeg',label:'JPEG',supportsQuality:true}];const settings=defaultPhotoBatchExport('jpeg');validatePhotoExport(settings,formats);assert.equal(settings.metadata,'preserve-without-location');validatePhotoTargets(['a','b']);assert.throws(()=>validatePhotoTargets(['a','a']));
 for(const value of [{...settings,formatId:'missing'},{...settings,longEdge:0},{...settings,quality:NaN},{...settings,metadata:'guess'},{...settings,watermark:{...settings.watermark,opacity:2}}])assert.throws(()=>validatePhotoExport(value,formats));
});
test('reported export progress rejects impossible counts without inventing completion',()=>{
 validatePhotoExportProgress({completed:0,failed:0,total:0});validatePhotoExportProgress({completed:4,failed:1,total:5});for(const p of [{completed:5,failed:1,total:5},{completed:1.5,failed:0,total:5},{completed:0,failed:-1,total:1}])assert.throws(()=>validatePhotoExportProgress(p));
});
