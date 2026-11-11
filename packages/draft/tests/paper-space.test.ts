import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {DraftDocument} from '../src/index';
it('drives real sheet/viewport CRUD, clipped sheet rendering and snapshot reopen through the CLI host',async()=>{
 const host=new CliHost();let doc:DraftDocument|undefined,reopened:DraftDocument|undefined;
 try{
  doc=await DraftDocument.open(host);
  const sheet=(await doc.addSheet('Site plan',{width:100,height:50})).data.sheet_id;
  const other=(await doc.addSheet('Detail',{width:200,height:100,margin_top:20,margin_right:20,margin_bottom:20,margin_left:20})).data.sheet_id;
  await expect(doc.addSheet('Site plan',{width:100,height:50})).rejects.toThrow();
  await expect(doc.addViewport({sheet:other,x:0,y:0,width:210,height:10,center_x:0,center_y:0,scale:1})).rejects.toThrow();
  const a=(await doc.addPoint(0,0)).data.point_id,b=(await doc.addPoint(100,0)).data.point_id;
  await doc.addSegment(a,b,{color:[0,0,0,255],width:0.5});
  const vp=(await doc.addViewport({sheet,x:20,y:10,width:60,height:30,center_x:5,center_y:0,scale:4})).data.viewport_id;
  const described=(await doc.describe()).data;
  expect(described.sheets?.[String(sheet)]).toMatchObject({name:'Site plan',width:100,height:50,margin_top:10});
  expect(described.viewports?.[String(vp)]).toMatchObject({sheet,x:20,y:10,scale:4,visible:true});
  const r=await doc.renderSheet(sheet,96);
  expect(r.data.width).toBe(378);expect(r.data.height).toBe(189);
  const rgba=Buffer.from(r.data.pixels_b64!,'base64');
  expect(rgba.length).toBe(378*189*4);
  const dark=(x:number,y:number)=>{const i=(y*378+x)*4;return rgba[i]!<128&&rgba[i+1]!<128&&rgba[i+2]!<128;};
  const white=(x:number,y:number)=>{const i=(y*378+x)*4;return rgba[i]===255&&rgba[i+1]===255&&rgba[i+2]===255&&rgba[i+3]===255;};
  let inside=0;for(let y=39;y<150;y++)for(let x=77;x<302;x++)if(dark(x,y))inside++;
  expect(inside).toBeGreaterThan(50);
  for(let y=39;y<150;y++)for(const x of[10,320,350])expect(white(x,y)).toBe(true);
  for(let y=60;y<140;y++)expect(white(310,y)).toBe(true);
  await expect(doc.renderSheet(9999)).rejects.toThrow();
  await expect(doc.renderSheet(sheet,10)).rejects.toThrow();
  // Locked viewport, sheet-removal guard, undo and snapshot reopen.
  await doc.updateViewport(vp,{locked:true});
  await expect(doc.updateViewport(vp,{scale:2})).rejects.toThrow();
  await expect(doc.removeViewport(vp)).rejects.toThrow();
  await doc.updateViewport(vp,{locked:false});
  await expect(doc.removeSheet(sheet)).rejects.toThrow();
  const bytes=await doc.save();
  reopened=await DraftDocument.openSnapshot(host,bytes);
  expect(await reopened.save()).toEqual(bytes);
  const red=(await reopened.describe()).data;
  expect(red.sheets?.[String(other)]?.name).toBe('Detail');
  expect(red.viewports?.[String(vp)]?.sheet).toBe(sheet);
  await reopened.removeViewport(vp);
  await reopened.removeSheet(sheet);
  expect((await reopened.describe()).data.sheets?.[String(sheet)]).toBeUndefined();
  expect(await reopened.undo()).toBe(true);
  expect((await reopened.describe()).data.sheets?.[String(sheet)]?.name).toBe('Site plan');
  expect(await reopened.undo()).toBe(true);
  expect((await reopened.describe()).data.viewports?.[String(vp)]?.sheet).toBe(sheet);
  await reopened.updateViewport(vp,{visible:false});
  const hidden=await reopened.renderSheet(sheet);
  const hr=Buffer.from(hidden.data.pixels_b64!,'base64');
  let interior=0;for(let y=39;y<150;y++)for(let x=77;x<302;x++){const i=(y*378+x)*4;if(hr[i]!<128&&hr[i+1]!<128&&hr[i+2]!<128)interior++}
  expect(interior).toBe(0);
 }finally{await reopened?.close();await doc?.close();await host.dispose();}
});
