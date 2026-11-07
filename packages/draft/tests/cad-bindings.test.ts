import {it,expect,vi} from 'vitest';
import {bindDraftingCommandLine,bindDraftingSnaps} from '../src/cad-bindings';
import type {DraftDocument,DraftState} from '../src/index';
const ok=<T>(data:T)=>({data,events:[]});
it('executes real command callback through host admission and retains failed input',async()=>{
 const executeCommand=vi.fn(async(command:string)=>{if(command==='CIRCLE')throw new Error('unsupported command');return ok({message:'Line created',result:{segment_id:3}});});
 const entries:unknown[]=[],onInput=vi.fn(),perform=vi.fn(async(action:()=>Promise<unknown>)=>{await action();});
 const binding=bindDraftingCommandLine({executeCommand} as Pick<DraftDocument,'executeCommand'>,{history:[],busy:false,isCurrent:()=>true,perform,onInput,onCancel:vi.fn(),recordHistory:entry=>entries.push(entry)});
 await expect(binding.onExecute('LINE 0 0 1 1')).resolves.toMatchObject({result:{segment_id:3}});expect(perform).toHaveBeenCalledOnce();expect(entries[0]).toMatchObject({kind:'result'});expect(onInput).not.toHaveBeenCalled();
 await expect(binding.onExecute('CIRCLE')).rejects.toThrow('unsupported');expect(entries[1]).toMatchObject({kind:'error'});expect(onInput).not.toHaveBeenCalled();
});
it('rejects queued cancellation before dispatch without inventing rollback after commit',async()=>{
 const executeCommand=vi.fn(async()=>ok({message:'Point created',result:{point_id:1}})),controller=new AbortController();
 const binding=bindDraftingCommandLine({executeCommand} as Pick<DraftDocument,'executeCommand'>,{history:[],busy:false,isCurrent:()=>true,perform:async action=>{controller.abort();await action();},onInput:vi.fn(),onCancel:vi.fn(),recordHistory:vi.fn()});
 await expect(binding.onExecute('POINT 0 0',controller.signal)).rejects.toThrow('cancelled');expect(executeCommand).not.toHaveBeenCalled();
});
it('maps actual world guide candidates and every admitted canonical setting',async()=>{
 const setSnapSettings=vi.fn(async()=>ok({ok:true}));
 const state={snaps:{grid:true,spacing:10,origin_x:0,origin_y:0,endpoint:true,midpoint:true,projection:true,intersection:true,ortho:true,polar:true,polar_increment:100}} as DraftState;
 const feedback={actualViewport:true};const binding=bindDraftingSnaps({setSnapSettings} as Pick<DraftDocument,'setSnapSettings'>,{state,sourceRevision:1,query:{source_revision:1,candidate:{kind:'polar',x:2,y:3,distance:0.2,sources:[],angle_degrees:100}},isCurrent:()=>true,perform:async action=>{await action();},renderFeedback:()=>feedback});
 expect(binding.candidate).toMatchObject({kind:'polar',world:[2,3,0],distance:0.2});expect(binding.renderFeedback()).toBe(feedback);await binding.onCommit({...binding.settings,polarIncrement:45});expect(setSnapSettings).toHaveBeenCalledWith(expect.objectContaining({ortho:true,polar:true,polar_increment:45,spacing:10}));
 await expect(binding.onCommit({...binding.settings,enabled:{circleCenter:true}})).rejects.toThrow('Unsupported');
});

it('withholds a late snap query from an older authoritative revision or closed session',async()=>{
 const state={snaps:{grid:true,spacing:10,origin_x:0,origin_y:0,endpoint:true,midpoint:true,projection:true,intersection:true,ortho:true,polar:true,polar_increment:100}} as DraftState;
 const viewport={currentWorldViewport:true};let sourceRevision=1;let complete!:(value:{source_revision:number;candidate:{kind:'endpoint';x:number;y:number;distance:number;sources:number[]}})=>void;
 const pending=new Promise<Parameters<typeof complete>[0]>(resolve=>{complete=resolve;});sourceRevision=2;complete({source_revision:1,candidate:{kind:'endpoint',x:99,y:99,distance:0,sources:[1]}});const query=await pending;
 const doc={setSnapSettings:vi.fn(async()=>ok({ok:true}))} as Pick<DraftDocument,'setSnapSettings'>;
 const host={state,sourceRevision,query,isCurrent:()=>true,perform:async(action:()=>Promise<unknown>)=>{await action();},renderFeedback:()=>viewport};
 expect(bindDraftingSnaps(doc,host).candidate).toBeNull();expect(bindDraftingSnaps(doc,host).renderFeedback()).toBe(viewport);
 expect(bindDraftingSnaps(doc,{...host,sourceRevision:1,isCurrent:()=>false}).candidate).toBeNull();
});
it('exposes real circular modes while tangent availability requires the actual world anchor',async()=>{
 const state={snaps:{grid:false,spacing:10,origin_x:0,origin_y:0,endpoint:false,midpoint:false,projection:false,intersection:true,ortho:false,polar:false,polar_increment:45,center:true,nearest_circle:true,tangent:true}} as DraftState;
 const setSnapSettings=vi.fn(async()=>ok({ok:true}));const doc={setSnapSettings} as Pick<DraftDocument,'setSnapSettings'>;
 const host={state,sourceRevision:2,query:{source_revision:2,candidate:null},isCurrent:()=>true,perform:async(action:()=>Promise<unknown>)=>{await action();},renderFeedback:()=>null};
 const noAnchor=bindDraftingSnaps(doc,host);expect(noAnchor.modes.find(m=>m.id==='tangent')?.available).toBe(false);
 const bound=bindDraftingSnaps(doc,{...host,anchorAvailable:true});expect(bound.modes.find(m=>m.id==='tangent')?.available).toBe(true);
 await bound.onCommit(bound.settings);expect(setSnapSettings).toHaveBeenCalledWith(expect.objectContaining({center:true,nearest_circle:true,tangent:true}));
});
