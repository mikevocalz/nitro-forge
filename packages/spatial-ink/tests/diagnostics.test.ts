import {describe,it,expect} from 'vitest';
import {getMuseDiagnostics,subscribeMuseSpatialInk,type MuseNativeSample} from '../src';

const sample: MuseNativeSample = {tracked:true,position:[1,2,3],headPosition:[0,1,0],tipPressed:false,primaryPressed:false,secondaryPressed:false,pressure:0};
describe('native six-degree-of-freedom diagnostics',()=>{
 it('does not fabricate orientation on a legacy position-only bridge',()=>{
  expect(getMuseDiagnostics(sample)).toEqual({pose:'position-only',position:[1,2,3],orientation:null,pressure:0,poseTimestampMs:null});
 });
 it('preserves a real unit pose, zero tip pressure and the native read time',()=>{
  expect(getMuseDiagnostics({...sample,orientation:[0,0,0,1],tipPressure:0,pressure:0.9,poseTimestampMs:24})).toEqual({pose:'six-dof',position:[1,2,3],orientation:[0,0,0,1],pressure:0,poseTimestampMs:24});
 });
 it('rejects invalid orientation and does not borrow side-button force for a missing tip sensor',()=>{
  expect(getMuseDiagnostics({...sample,orientation:[0,0,0,0],tipPressure:null,pressure:1}).orientation).toBeNull();
  expect(getMuseDiagnostics({...sample,tipPressure:null,pressure:1}).pressure).toBeNull();
  expect(getMuseDiagnostics({...sample,tracked:false,orientation:[0,0,0,1]}).pose).toBe('untracked');
 });
 it('cancellation can unsubscribe reentrantly without a second cancel or retained pose',()=>{
  let receive!:(sample:MuseNativeSample)=>void;let close!:()=>void;let unsubscribed=0;const phases:string[]=[];
  close=subscribeMuseSpatialInk({subscribe:fn=>{receive=fn;return()=>{unsubscribed++;};},onEvent:event=>{phases.push(event.phase);if(event.phase==='cancel')close();}});
  receive({...sample,tipPressed:true});receive({...sample,tracked:false});
  expect(phases).toEqual(['down','cancel','hover-exit']);expect(unsubscribed).toBe(1);
 });
});
