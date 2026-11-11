import {expect,it,vi} from 'vitest';
import {DesignDocument,OPS} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

function mockHost(){
 const apply=vi.fn(async()=>({events:[],data:{ok:true,id:'hotspot-1'}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 return {host,apply};
}

it('projects prototype catalog ops with engine payload shapes',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.definePrototypeScreen(7,{entry:true});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.definePrototypeScreen,payload:{node:7,entry:true}});
 await doc.updatePrototypeScreen(7,false);
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.updatePrototypeScreen,payload:{node:7,entry:false}});
 await doc.removePrototypeScreen(7);
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removePrototypeScreen,payload:{node:7}});
 await doc.definePrototypeHotspot({screen:7,label:'Go',x:0.1,y:0.1,width:0.5,height:0.5});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.definePrototypeHotspot,payload:{screen:7,label:'Go',x:0.1,y:0.1,width:0.5,height:0.5}});
 await doc.definePrototypeHotspot({id:'hot-x',screen:7,label:'Go',x:0,y:0,width:1,height:1});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.definePrototypeHotspot,payload:{id:'hot-x',screen:7,label:'Go',x:0,y:0,width:1,height:1}});
 await doc.updatePrototypeHotspot('hot-x',{x:0.2,label:'Next'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.updatePrototypeHotspot,payload:{id:'hot-x',x:0.2,label:'Next'}});
 await doc.removePrototypeHotspot('hot-x');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removePrototypeHotspot,payload:{id:'hot-x'}});
 await doc.close();
});

it('projects transition and interaction ops including typed targets and null clears',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.definePrototypeTransition({id:'tr-1',label:'Slide',kind:'slide',direction:'left',easing:'ease-in-out',duration_ms:300});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.definePrototypeTransition,payload:{id:'tr-1',label:'Slide',kind:'slide',direction:'left',easing:'ease-in-out',duration_ms:300}});
 await doc.updatePrototypeTransition('tr-1',{kind:'dissolve',direction:null});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.updatePrototypeTransition,payload:{id:'tr-1',kind:'dissolve',direction:null}});
 await doc.removePrototypeTransition('tr-1');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removePrototypeTransition,payload:{id:'tr-1'}});
 await doc.definePrototypeInteraction({hotspot:'hot-1',trigger:'tap',action:'navigate',target:{kind:'screen',node:9},transition:'tr-1',delay_ms:0});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.definePrototypeInteraction,payload:{hotspot:'hot-1',trigger:'tap',action:'navigate',target:{kind:'screen',node:9},transition:'tr-1',delay_ms:0}});
 await doc.definePrototypeInteraction({screen:9,trigger:'timer',delay_ms:500,action:'set-variable',target:{kind:'variable',id:'flag'},value:{kind:'boolean',value:true}});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.definePrototypeInteraction,payload:{screen:9,trigger:'timer',delay_ms:500,action:'set-variable',target:{kind:'variable',id:'flag'},value:{kind:'boolean',value:true}}});
 await doc.updatePrototypeInteraction('ix-1',{target:null,transition:null,duration_ms:null,hotspot:null,screen:9});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.updatePrototypeInteraction,payload:{id:'ix-1',target:null,transition:null,duration_ms:null,hotspot:null,screen:9}});
 await doc.removePrototypeInteraction('ix-1');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removePrototypeInteraction,payload:{id:'ix-1'}});
 await doc.prototypeGraph();
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.prototypeGraph,payload:{}});
 await doc.resolvePrototypeEvent({hotspot:'hot-1',trigger:'tap'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.resolvePrototypeEvent,payload:{hotspot:'hot-1',trigger:'tap'}});
 await doc.close();
});
