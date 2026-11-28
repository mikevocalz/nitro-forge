import type {SkCanvas,SkGraphiteContext} from 'react-native-skia';
import {validateViewport,type CanvasViewport} from './canvas-viewport.ts';
/** Synchronously record and submit one complete document frame. Never reports presentation. */
export function submitCanvasFrame(context:SkGraphiteContext,viewport:CanvasViewport,clearColor:Parameters<SkCanvas['clear']>[0],draw:(canvas:SkCanvas,viewport:CanvasViewport)=>void,isCurrent:()=>boolean):boolean{
 validateViewport(viewport);
 if(!isCurrent()||viewport.width<=0||viewport.height<=0||context.width<=0||context.height<=0)return false;
 const canvas=context.beginRecording();let recording:ReturnType<SkGraphiteContext['finishRecording']>|undefined,finished=false;
 try{
  canvas.clear(clearColor);canvas.save();
  try{canvas.scale(context.width/viewport.width,context.height/viewport.height);canvas.translate(viewport.panX,viewport.panY);canvas.scale(viewport.zoom,viewport.zoom);const result:unknown=draw(canvas,viewport);if(result&&typeof (result as {then?:unknown}).then==='function')throw new TypeError('Canvas draw callbacks must finish synchronously');}
  finally{canvas.restore();}
  finished=true;recording=context.finishRecording();
  if(!isCurrent())return false;
  context.submit(recording);return true;
 }finally{
  // Graphite exposes no abort operation. Close a failed recording without submitting it.
  if(!finished)recording=context.finishRecording();
  recording?.dispose();
 }
}
