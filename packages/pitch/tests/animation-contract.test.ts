import {expect,it,vi} from 'vitest';
import type {EngineHost} from '@nitro-forge/ignition';
import {PitchDocument,type PitchAnimationTrigger} from '../src/index';

it('owns trigger metadata and explicit click history before delayed transport',async()=>{
 let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});
 const seen:{op:string;payload?:unknown}[]=[];
 const host={open:vi.fn(async()=>7),close:vi.fn(async()=>true),apply:vi.fn(async(_id:number,command:{op:string;payload?:unknown})=>{
  if(command.op!=='new')await gate;seen.push(command);return{data:{objects:[],schedule:[],index:0},events:[]};
 })} as unknown as EngineHost;
 const doc=await PitchDocument.open(host);
 const trigger:PitchAnimationTrigger={type:'on-click',click_index:0};const adding=doc.addAnimation(1,2,'fadeOut',0,1,trigger);trigger.click_index=9;
 const clicks=[1];const sampling=doc.slideAt(1,2,clicks);clicks[0]=99;finish();await adding;await sampling;
 expect(seen.find(command=>command.op==='addTriggeredAnimationV1')!.payload).toMatchObject({trigger:{type:'on-click',click_index:0}});
 expect(seen.find(command=>command.op==='slideAtWithClicksV1')!.payload).toMatchObject({click_times:[1]});
 const count=seen.length;expect(()=>doc.slideAt(1,2,[2,1])).toThrow('ordered');expect(seen).toHaveLength(count);
 await doc.close();
});

it('routes explicit intent through versioned operations and fails closed on old hosts',async()=>{
 const seen:string[]=[];
 const host={open:vi.fn(async()=>7),close:vi.fn(async()=>true),apply:vi.fn(async(_id:number,command:{op:string})=>{
  seen.push(command.op);if(command.op.endsWith('V1'))throw new Error('unknown operation');
  return{data:{objects:[],schedule:[],index:0},events:[]};
 })} as unknown as EngineHost;
 const doc=await PitchDocument.open(host);
 await doc.addAnimation(1,2,'fadeIn',0,1);await doc.updateAnimation(1,0,{duration_s:2});await doc.slideAt(1,0);
 expect(seen).toEqual(['new','addAnimation','updateAnimation','slideAt']);
 await expect(doc.addAnimation(1,2,'fadeIn',0,1,{type:'absolute'})).rejects.toThrow('unknown operation');
 await expect(doc.updateAnimation(1,0,{trigger:{type:'on-click',click_index:0}})).rejects.toThrow('unknown operation');
 await expect(doc.slideAt(1,0,[])).rejects.toThrow('unknown operation');
 expect(seen.slice(-3)).toEqual(['addTriggeredAnimationV1','updateTriggeredAnimationV1','slideAtWithClicksV1']);
 await doc.close();
});
