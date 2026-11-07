import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument,bindDraftingCommandLine} from '../src/index';
it('runs the command binding through real CLI geometry, pixels, history and owned reopen',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);const entries:unknown[]=[];
  const binding=bindDraftingCommandLine(doc,{history:[],busy:false,isCurrent:()=>true,perform:async action=>{await action();},onInput:()=>{},onCancel:()=>{},recordHistory:entry=>entries.push(entry)});
  await binding.onExecute('LINE 0 0.5 3 0.5');expect(entries[0]).toMatchObject({kind:'result'});
  const created=await doc.save();expect((await doc.renderFrame({width:3,height:1,origin_x:0,origin_y:0,scale:1})).data.pixels_b64).toBe(Buffer.from([0,0,0,255,0,0,0,255,0,0,0,255]).toString('base64'));
  await doc.undo();expect(Object.keys((await doc.describe()).data.points)).toHaveLength(0);await doc.redo();expect(await doc.save()).toEqual(created);
  await expect(binding.onExecute('CIRCLE 0 0 1')).rejects.toThrow();expect(entries[1]).toMatchObject({kind:'error'});expect(await doc.save()).toEqual(created);
  await doc.setSnapSettings({grid:false,endpoint:false,midpoint:false,projection:false,intersection:false,ortho:true});const snap=await doc.executeCommand('SNAP 2 2 2 0 0');expect(snap.data.result).toMatchObject({candidate:{kind:'ortho',x:2,y:0,angle_degrees:0}});
  const bytes=await doc.save();reopened=await DraftDocument.openSnapshot(host,bytes);expect(await reopened.save()).toEqual(bytes);expect((await reopened.describe()).data.snaps.ortho).toBe(true);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
