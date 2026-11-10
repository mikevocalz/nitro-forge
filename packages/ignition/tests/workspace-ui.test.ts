import {afterAll,beforeAll,expect,it} from 'vitest';
import {CliHost} from '../src/host-cli';
import {WorkspaceSession,type WorkspaceStore} from '../src/workspace';
import {workspaceUiBindings,workspaceUiView} from '../src/workspace-ui';
import {createTransferUiBindings,transferUiFormats,transferUiImports} from '../src/transfer-ui';
import {NFD_EXPORT,NFD_IMPORT,normalizeFilename} from '../src/transfer';
let host:CliHost;beforeAll(()=>{host=new CliHost();});afterAll(async()=>{await host.dispose();});
function options(){const map=new Map<string,string>();const store:WorkspaceStore={getString:k=>map.get(k),set:(k,v)=>{map.set(k,v);},remove:k=>{map.delete(k);}};return {storeKey:'test',store,modes:[{id:'edit',label:'Edit',defaultLayout:{floating:[]}}],builtInPresets:[{id:'edit',modeId:'edit',name:'Edit',layout:{floating:[]}}]};}
it('layout views are isolated and UI bindings publish persistence without reopening the document',async()=>{
 const opts=options(),ws=await WorkspaceSession.open(host,'tally',opts);try{
 const seen:unknown[]=[];const bindings=workspaceUiBindings(ws,s=>seen.push(s));const doc=ws.document;bindings.onLayoutChange('edit',{floating:[{id:'panel'}]});bindings.onSaveAs('Mine');const view=workspaceUiView(ws,value=>{const layout=value as {floating:unknown[]};if(!Array.isArray(layout.floating))throw Error('layout');return layout;});
 expect(view.activeId).toBe('custom-1');view.layouts.edit!.floating.push('external');expect((workspaceUiView(ws,v=>v).layouts.edit as {floating:unknown[]}).floating).toHaveLength(1);expect(ws.document).toBe(doc);expect(seen).toHaveLength(2);opts.modes[0]!.label='External';expect(ws.state.modes[0]!.label).toBe('Edit');
 }finally{await ws.close();}
});
it('corrupt/duplicate persisted presets are dropped and built-in validation precedes document creation',async()=>{
 const opts=options();opts.store.set(opts.storeKey,JSON.stringify({v:1,activeModeId:'edit',custom:[{id:'edit',name:'spoof',modeId:'edit',layout:{}},{id:'custom-1',name:'Valid',modeId:'edit',layout:{}},{id:'custom-1',name:'Duplicate',modeId:'edit',layout:{}}]}));const ws=await WorkspaceSession.open(host,'tally',opts);try{expect(ws.state.presets.map(p=>p.name)).toEqual(['Edit','Valid']);}finally{await ws.close();}
 await expect(WorkspaceSession.open(host,'tally',{...opts,builtInPresets:[...opts.builtInPresets,...opts.builtInPresets]})).rejects.toThrow(/duplicate/);
});
it('transfer UI publishes done only after real bytes reach the explicit destination',async()=>{
 const ws=await WorkspaceSession.open(host,'tally',options());try{
 const states:unknown[]=[],writes:unknown[]=[];const bindings=createTransferUiBindings({document:ws.document,exports:[NFD_EXPORT],imports:[NFD_IMPORT],onStatus:s=>states.push(s),write:async(result,destination)=>{expect(result.bytes.slice(0,4)).toEqual(new Uint8Array([78,70,68,49]));writes.push(destination);}});
 await bindings.onExport({formatId:'nfd',filename:'Book.nfd',metadata:{},destination:'download'});expect(writes).toEqual(['download']);expect(states).toEqual([{kind:'working'},{kind:'done'}]);await expect(bindings.onExport({formatId:'nfd',filename:'CON.nfd',metadata:{},destination:'files'})).rejects.toThrow(/reserved/);expect(writes).toHaveLength(1);expect(states.at(-1)).toMatchObject({kind:'error'});expect(transferUiFormats([NFD_EXPORT])[0]!.mimeType).toContain('nitro-forge');expect(transferUiImports([NFD_IMPORT])[0]!.extensions).toEqual(['nfd']);
 }finally{await ws.close();}
});
it('platform-safe file names reject reserved names and control characters',()=>{
 for(const name of ['CON.nfd','nul.txt','name\u007f.nfd','.hidden'])expect(()=>normalizeFilename(name,NFD_EXPORT)).toThrow();expect(normalizeFilename(' Book ',NFD_EXPORT)).toBe('Book.nfd');
});
