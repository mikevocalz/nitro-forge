import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMotionRenderSettings,validateMotionRenderJobs,moveQueuedRenderJob} from '../src/motion/motion-render.ts';
import {validateMotionEasing,validateMotionEasingPresets,MOTION_EASING_PRESETS} from '../src/motion/motion-easing.ts';
const settings={compositionId:'a',formatId:'png',profileId:'p3',destinationId:'exports',outputName:'Harbor',startFrame:0,endFrame:59,frameRate:{numerator:30000,denominator:1001},alpha:'straight',framePadding:6};
const job=(id,status)=>({id,label:id,settings,status,progress:null});
test('render requests preserve rational timing and reject invalid ranges or path-bearing names',()=>{
 validateMotionRenderSettings(settings);assert.deepEqual(settings.frameRate,{numerator:30000,denominator:1001});for(const change of [{outputName:''},{outputName:'../Harbor'},{startFrame:80},{endFrame:1.5},{frameRate:{numerator:0,denominator:1}},{alpha:'guess'}])assert.throws(()=>validateMotionRenderSettings({...settings,...change}));validateMotionRenderSettings({...settings,outputName:''},true);
});
test('queued reorder preserves active jobs and progress cannot exceed provider totals',()=>{
 const jobs=[job('a','queued'),job('active','running'),job('b','queued')];assert.deepEqual(moveQueuedRenderJob(jobs,'b',-1),['b','active','a']);assert.deepEqual(moveQueuedRenderJob(jobs,'a',-1),['a','active','b']);assert.throws(()=>moveQueuedRenderJob(jobs,'active',1));assert.throws(()=>validateMotionRenderJobs([{...job('a','running'),progress:{completedFrames:61,totalFrames:60}}]));
});
test('easing controls retain Bezier overshoot and physical spring parameters without clamping',()=>{
 validateMotionEasingPresets(MOTION_EASING_PRESETS);const spring=MOTION_EASING_PRESETS.find(p=>p.id==='spring');assert.equal(spring.value.mass,1);const overshoot=MOTION_EASING_PRESETS.find(p=>p.id==='overshoot');assert.equal(overshoot.value.y1,1.56);assert.throws(()=>validateMotionEasing({kind:'bezier',x1:-1,y1:0,x2:1,y2:1}));assert.throws(()=>validateMotionEasing({kind:'spring',mass:0,stiffness:100,damping:10,velocity:0}));
});
