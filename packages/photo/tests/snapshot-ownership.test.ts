import {expect,it,vi} from 'vitest';
import {PhotoDocument} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

it.each(['uint8array','buffer'] as const)('owns the exact %s snapshot view before asynchronous session allocation',async(kind)=>{
 let finishOpen!:(id:number)=>void;
 const allocation=new Promise<number>(resolve=>{finishOpen=resolve;});
 const restore=vi.fn(async(_id:number,_bytes:Uint8Array)=>{});
 const close=vi.fn(async()=>true);
 const host={open:vi.fn(()=>allocation),restore,close} as unknown as EngineHost;
 const backing=kind==='buffer'?Buffer.from([91,92,1,2,3,93]):new Uint8Array([91,92,1,2,3,93]);
 const pending=PhotoDocument.openSnapshot(host,backing.subarray(2,5));
 backing.fill(0);finishOpen(42);
 const document=await pending;
 expect(restore).toHaveBeenCalledExactlyOnceWith(42,new Uint8Array([1,2,3]));
 expect(host.open).toHaveBeenCalledWith('photo');
 await document.close();expect(close).toHaveBeenCalledWith(42);
});

it('closes a newly allocated session when restoring owned bytes fails',async()=>{
 const failure=new Error('invalid catalog');
 const close=vi.fn(async()=>true);
 const host={open:vi.fn(async()=>43),restore:vi.fn(async()=>{throw failure;}),close} as unknown as EngineHost;
 await expect(PhotoDocument.openSnapshot(host,new Uint8Array([1,2,3]))).rejects.toBe(failure);
 expect(close).toHaveBeenCalledWith(43);
});
