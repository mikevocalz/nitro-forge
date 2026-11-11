import {expect,it,vi} from 'vitest';
import {DesignDocument,OPS} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

function mockHost(){
 const apply=vi.fn(async()=>({events:[],data:{ok:true}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 return {host,apply};
}

it('projects variable and mode ops with engine payload shapes',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.defineMode({name:'Light'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.defineMode,payload:{name:'Light'}});
 await doc.renameMode('light','Light theme');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.renameMode,payload:{id:'light',name:'Light theme'}});
 await doc.removeMode('light');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removeMode,payload:{id:'light'}});
 await doc.defineVariable({name:'Gap',type:'number',values:{light:{kind:'number',value:4}}});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.defineVariable,payload:{name:'Gap',type:'number',values:{light:{kind:'number',value:4}}}});
 await doc.setVariableValue('gap','dark',{kind:'alias',variable_id:'gap-base'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.setVariableValue,payload:{id:'gap',mode:'dark',value:{kind:'alias',variable_id:'gap-base'}}});
 await doc.removeVariable('gap');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removeVariable,payload:{id:'gap'}});
 await doc.setActiveMode('dark');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.setActiveMode,payload:{id:'dark'}});
 await doc.close();
});

it('projects binding ops and read filters without widening payloads',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.bindVariable(7,'fill_r','accent');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.bindVariable,payload:{node_id:7,path:'fill_r',variable_id:'accent'}});
 await doc.unbindVariable(7,'padding_top');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.unbindVariable,payload:{node_id:7,path:'padding_top'}});
 await doc.describeVariables();
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.describeVariables,payload:{}});
 await doc.listBindings();
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.listBindings,payload:{}});
 await doc.listBindings(7);
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.listBindings,payload:{node_id:7}});
 await doc.close();
});
