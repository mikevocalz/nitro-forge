import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {LayerThumbnail} from '../layers/LayerThumbnail.tsx';
import type {ThumbnailSource} from '../layers/layer-thumbnail-model.ts';
import {VideoFilmstrip,type VideoFilmstripProps} from './VideoFilmstrip.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export type VideoCover={kind:'frame';frame:number}|{kind:'image';assetId:string};
export interface CoverFramePickerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:VideoCover|null;frame:number;preview:ReactNode;
 filmstrip:Omit<VideoFilmstripProps,'scope'|'revision'|'onSeek'>;
 images:readonly {id:string;label:string;source:ThumbnailSource}[];
 onSeek:(frame:number,signal?:AbortSignal)=>void|Promise<unknown>;
 onPickImage:(signal?:AbortSignal)=>void|Promise<unknown>;
 onCommit:(cover:VideoCover,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Chooses actual source frames/assets; applying the exported cover remains an engine transaction. */
export function CoverFramePicker({scope='cover-frame',revision=0,...props}:CoverFramePickerProps){
 const {value,frame,preview,filmstrip,images,onSeek:_seek,onPickImage:_pick,onCommit:_commit,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(frame)||frame<0||frame>=Math.max(1,filmstrip.durationFrames)||images.length>256||new Set(images.map(i=>i.id)).size!==images.length||images.some(i=>!i.id.trim()||i.id.length>512||!i.label.trim()||i.label.length>1024))throw new RangeError('Invalid cover selection');
 const owner=JSON.stringify([...controlIdentity(scope,revision),filmstrip.sourceId,filmstrip.sourceRevision,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Video cover">
  {preview}
  <VideoFilmstrip key={owner} {...filmstrip} scope={scope} revision={revision} unstyled={unstyled} {...(off?{disabledReason:disabledReason??'Cover operation in progress'}:{})} onSeek={next=>guard.run('seek',(host,signal)=>host.onSeek(next,signal))}/>
  <Button title={'Use frame '+frame+' as cover'} disabled={off||filmstrip.durationFrames===0} unstyled={unstyled} onPress={()=>guard.run('cover',(host,signal)=>host.filmstrip.durationFrames>0&&host.frame<host.filmstrip.durationFrames?host.onCommit({kind:'frame',frame:host.frame},signal):undefined)}/>
  <Button title="Choose a cover image" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.run('image',(host,signal)=>host.onPickImage(signal))}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{images.map(image=><View key={image.id} style={{gap:4}}>
   <LayerThumbnail scope={owner} source={image.source} width={96} height={64} label={image.label+' cover candidate'} unstyled={unstyled}/>
   <Button title={'Use '+image.label+' as cover'} disabled={off} unstyled={unstyled} onPress={()=>guard.run('cover',(host,signal)=>host.images.some(i=>i.id===image.id)?host.onCommit({kind:'image',assetId:image.id},signal):undefined)}/>
  </View>)}</View>
  <Text {...{className:unstyled?undefined:'text-text'}}>Current cover: {value===null?'Not selected':value.kind==='frame'?'frame '+value.frame:'image '+value.assetId}</Text>
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
