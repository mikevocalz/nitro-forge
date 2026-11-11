import {expect,it,vi} from 'vitest';
import {DesignDocument,OPS} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

function mockHost(){
 const apply=vi.fn(async()=>({events:[],data:{ok:true,node_id:7}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 return {host,apply};
}

it('projects component and instance ops with engine payload shapes',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.createComponent(3,{name:'Button',variants:[{name:'hover',properties:[{node:4,path:'fill',value:[1,2,3,255]}]}]});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.createComponent,payload:{id:3,name:'Button',variants:[{name:'hover',properties:[{node:4,path:'fill',value:[1,2,3,255]}]}]}});
 await doc.updateComponent(3,{variants:[]});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.updateComponent,payload:{id:3,variants:[]}});
 await doc.createInstance(3,{parent:1,x:4,variant:'hover',overrides:[{node:5,path:'visible',value:false}]});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.createInstance,payload:{component:3,parent:1,x:4,variant:'hover',overrides:[{node:5,path:'visible',value:false}]}});
 await doc.updateInstance(7,{variant:null,overrides:null});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.updateInstance,payload:{id:7,variant:null,overrides:null}});
 await doc.detachInstance(7);
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.detachInstance,payload:{id:7}});
 await doc.describeComponents();
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.describeComponents,payload:{}});
 await doc.close();
});
