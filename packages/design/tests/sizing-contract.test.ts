import {expect,it,vi} from 'vitest';
import {DesignDocument} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

it('projects only writable sizing fields without allowing structural extras to retarget the node or axis',async()=>{
 const apply=vi.fn(async()=>({events:[],data:{ok:true}}));
 const close=vi.fn(async()=>true);
 const host={open:async()=>42,apply,close} as unknown as EngineHost;
 const doc=await DesignDocument.open(host);apply.mockClear();
 const structurallyCompatible={mode:'fixed' as const,value:100,id:999,axis:'y',canHug:true,canFill:false,unavailableReason:'not a write field'};
 await doc.setAxisSizing(7,'x',structurallyCompatible);
 expect(apply).toHaveBeenCalledExactlyOnceWith(42,{op:'setAxisSizing',payload:{id:7,axis:'x',mode:'fixed',value:100}});
 await doc.close();expect(close).toHaveBeenCalledWith(42);
});

it('returns authoritative capability results and preserves rejected writes for awaited callers',async()=>{
 const result={events:[],data:{x:{mode:'fixed',value:100,fixedValue:100,resolvedValue:100,canHug:false,canFill:true,hugReason:'cyclic sizing'},y:{mode:'fixed',value:100,fixedValue:100,resolvedValue:100,canHug:true,canFill:true}}};
 const apply=vi.fn(async()=>({events:[],data:{ok:true}} as unknown));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 const doc=await DesignDocument.open(host);apply.mockResolvedValueOnce(result);
 expect(await doc.readAxisSizing(7)).toBe(result);
 const failure=new Error('cyclic sizing');apply.mockRejectedValueOnce(failure);
 await expect(doc.setAxisSizing(7,'x',{mode:'hug'})).rejects.toBe(failure);
 await doc.close();
});
