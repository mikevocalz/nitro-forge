import {expect,it,vi} from 'vitest';
import {DesignDocument,OPS} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

function mockHost(){
 const apply=vi.fn(async()=>({events:[],data:{ok:true}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 return {host,apply};
}

it('projects describeHandoff and exportSlice with engine payload shapes',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.describeHandoff();
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.describeHandoff,payload:{}});
 await doc.exportSlice(7);
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.exportSlice,payload:{node:7}});
 await doc.exportSlice(9,{scale:2});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.exportSlice,payload:{node:9,scale:2}});
 await doc.exportSlice(9,{scale:0.5});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.exportSlice,payload:{node:9,scale:0.5}});
 await doc.close();
});
