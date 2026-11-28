import {mediaProviderId} from './waveform-cache.ts';
import {Pressable,Text,View,type ViewProps} from 'react-native';
import {LayerThumbnail} from '../layers/LayerThumbnail.tsx';
import type {RasterPixels} from '../layers/layer-thumbnail-model.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {frameToX,visibleRange,type TimelineViewport} from './viewport.ts';
import {exact} from '../exact-optional.ts';
export interface VideoFilmstripProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sourceId:string;sourceRevision:number;durationFrames:number;viewport:TimelineViewport;height?:number;tileWidth?:number;
 /** Decode this source frame; max bounds the returned raster edge. */
 loadFrame:(frame:number,max:number,signal?:AbortSignal)=>Promise<RasterPixels>;
 onSeek?:(frame:number,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Only visible frame tiles are mounted; the bounded shared thumbnail cache owns their resources. */
export function VideoFilmstrip({scope='filmstrip',revision=0,...props}:VideoFilmstripProps){
 const {sourceId,sourceRevision,durationFrames,viewport,height=64,tileWidth=96,loadFrame,onSeek,unstyled=false,disabledReason,style,...rest}=props;
 const visible=visibleRange(viewport);
 if(!sourceId.trim()||sourceId.length>512||!Number.isSafeInteger(sourceRevision)||sourceRevision<0||!Number.isSafeInteger(durationFrames)||durationFrames<0||!Number.isFinite(height)||height<44||height>512||!Number.isFinite(tileWidth)||tileWidth<44||tileWidth>1024||viewport.widthPx>65536)throw new RangeError('Invalid filmstrip geometry');
 const owner=JSON.stringify([...controlIdentity(scope,revision),sourceId,sourceRevision,disabledReason,mediaProviderId(loadFrame)]),guard=useScopedControl(owner,props,disabledReason!==undefined);
 const step=Math.max(1,Math.ceil(tileWidth/viewport.pxPerFrame)),first=Math.max(0,Math.floor(visible.start/step)*step),end=Math.min(durationFrames,visible.end+step),frames:number[]=[];
 for(let frame=first;frame<end&&frames.length<512;frame+=step)frames.push(frame);
 return <View {...rest} style={[{width:viewport.widthPx,minWidth:0,gap:4},style]} accessibilityLabel="Video filmstrip">
  <View style={{height,overflow:'hidden'}}>{frames.map(frame=>{
   const image=<LayerThumbnail scope={owner} source={{kind:'loader',id:sourceId+':'+frame,revision:sourceRevision,load:(_id,max,signal)=>loadFrame(frame,max,signal)}} width={Math.min(1024,Math.max(44,step*viewport.pxPerFrame))} height={height} unstyled={unstyled} label={'Source frame '+frame}/>;
   return <View key={frame} style={{position:'absolute',left:frameToX(viewport,frame),top:0}}>{onSeek?<Pressable accessibilityRole="button" accessibilityLabel={'Seek to frame '+frame} disabled={disabledReason!==undefined||guard.pending} onPress={()=>guard.run('seek',(host,signal)=>host.onSeek?.(frame,signal))}>{image}</Pressable>:image}</View>;
  })}</View>
  {durationFrames===0?<Text {...{className:unstyled?undefined:'text-text'}}>No decoded source frames</Text>:null}<ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
