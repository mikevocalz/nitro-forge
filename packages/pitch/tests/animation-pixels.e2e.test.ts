import {expect,it} from 'vitest';
import {DocumentHandle,base64ToBytes} from '@nitro-forge/ignition';
import {CliHost} from '@nitro-forge/ignition/cli';
import {PitchDocument} from '../src/index';

it('samples real triggered exit opacity into actual Prism CPU pixels, including save/reopen',async()=>{
 const host=new CliHost();let pitch:PitchDocument|undefined;let reopened:PitchDocument|undefined;
 try{
  pitch=await PitchDocument.open(host);
  const object=(await pitch.addRect(1,0,0,4,4,[255,0,0,255])).data.object_id;
  await pitch.addAnimation(1,object,'fadeOut',0,2,{type:'on-click',click_index:0});
  const render=async(document:PitchDocument,time:number,clicks:readonly number[])=>{
   const resolved=(await document.slideAt(1,time,clicks)).data.objects[0]!;
   const prism=await DocumentHandle.open(host,'prism');
   try{
    await prism.apply('new',{width:4,height:4});
    const layer=(await prism.apply<{layer_id:number}>('addShape',{shape:{kind:'rect',x:resolved.x,y:resolved.y,w:resolved.w,h:resolved.h,fill:[255,0,0,255]}})).data.layer_id;
    await prism.apply('setLayerOpacity',{id:layer,opacity:resolved.opacity});
    const pixels=base64ToBytes((await prism.apply<{pixels_b64:string}>('flatten',{})).data.pixels_b64);
    return [...pixels.subarray(20,24)];
   }finally{await prism.close();}
  };
  expect(await render(pitch,1,[])).toEqual([255,0,0,255]);
  expect(await render(pitch,1,[0])).toEqual([255,0,0,128]);
  expect(await render(pitch,3,[0])).toEqual([0,0,0,0]);
  reopened=await PitchDocument.openSnapshot(host,await pitch.save());
  expect(await render(reopened,1,[0])).toEqual([255,0,0,128]);
 }finally{await reopened?.close();await pitch?.close();await host.dispose();}
});
