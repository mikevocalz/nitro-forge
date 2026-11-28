import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {FlatList} from 'react-native-gesture-handler';
import {Button} from '@nyc-tron/ui/components/Button';
import {MenuButton} from '@nyc-tron/ui/components/shell/MenuButton';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {MotionKeyframeTimeline,type MotionKeyframeTimelineProps} from '../motion/MotionKeyframeTimeline.tsx';
import {InOutRangeHandles} from './InOutRangeHandles.tsx';
import type {TimelineViewport} from './viewport.ts';
import type {FrameRate} from '../timebase.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface StickerTransform {x:number;y:number;rotation:number;scale:number}
export interface TimelineSticker {id:string;assetId:string;label:string;startFrame:number;endFrame:number;transform:StickerTransform;locked?:boolean}
export interface StickerMotionLaneProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 stickers:readonly TimelineSticker[];selectedId:string|null;onSelect:(id:string)=>void;catalog:readonly {id:string;label:string}[];
 durationFrames:number;frame:number;rate:FrameRate;viewport:TimelineViewport;surface:ReactNode;
 keyframes:Omit<MotionKeyframeTimelineProps,'scope'|'revision'|'disabled'|'unstyled'|'frameRate'>;
 onInsert:(assetId:string,frame:number,signal?:AbortSignal)=>void|Promise<unknown>;
 onRangeChange:(id:string,range:{startFrame:number;endFrame:number},signal?:AbortSignal)=>void|Promise<unknown>;
 onTransform:(id:string,transform:StickerTransform,signal?:AbortSignal)=>void|Promise<unknown>;
 onRemove:(id:string,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Sticker objects retain their own ranges, transforms and shared editable motion keys. */
export function StickerMotionLane({scope='sticker-motion',revision=0,...props}:StickerMotionLaneProps){
 const {stickers,selectedId,onSelect:_select,catalog,durationFrames,frame,rate,viewport,surface,keyframes,onInsert:_insert,onRangeChange:_range,onTransform:_transform,onRemove:_remove,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(durationFrames)||durationFrames<0||!Number.isSafeInteger(frame)||frame<0||stickers.length>10000||new Set(stickers.map(s=>s.id)).size!==stickers.length||stickers.some(s=>!s.id.trim()||s.id.length>512||!s.assetId.trim()||!s.label.trim()||!Number.isSafeInteger(s.startFrame)||!Number.isSafeInteger(s.endFrame)||s.startFrame<0||s.endFrame<=s.startFrame||s.endFrame>durationFrames||![s.transform.x,s.transform.y,s.transform.rotation,s.transform.scale].every(Number.isFinite)||Math.abs(s.transform.x)>1e6||Math.abs(s.transform.y)>1e6||Math.abs(s.transform.rotation)>3600||s.transform.scale<.01||s.transform.scale>100)||catalog.length>1000||new Set(catalog.map(c=>c.id)).size!==catalog.length||catalog.some(c=>!c.id.trim()||c.id.length>512||!c.label.trim()||c.label.length>1024))throw new RangeError('Invalid sticker timeline');
 const owner=JSON.stringify([...controlIdentity(scope,revision),selectedId,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined,selected=stickers.find(s=>s.id===selectedId);
 const edit=(patch:Partial<StickerTransform>)=>guard.run('transform',(host,signal)=>{const sticker=host.stickers.find(s=>s.id===selectedId);return sticker&&!sticker.locked?host.onTransform(sticker.id,{...sticker.transform,...patch},signal):undefined;});
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Sticker motion lane">
  {surface}
  <MenuButton label="Insert sticker" editScope={owner} disabled={off||catalog.length===0} unstyled={unstyled} items={catalog.map(c=>({id:c.id,label:c.label}))} onSelect={id=>guard.run('insert',(host,signal)=>host.catalog.some(c=>c.id===id)?host.onInsert(id,host.frame,signal):undefined)}><Text {...{className:unstyled?undefined:'text-text'}}>Insert sticker</Text></MenuButton>
  <FlatList horizontal data={stickers} keyExtractor={s=>s.id} style={{maxHeight:80}} initialNumToRender={10} windowSize={5} extraData={[off,selectedId]} renderItem={({item})=><Button title={item.label} accessibilityState={{selected:item.id===selectedId}} disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onSelect(item.id)}/>}/>
  {selected?<View key={selected.id} style={{gap:8}}>
   <Text {...{className:unstyled?undefined:'text-text'}}>{selected.label}: frames {selected.startFrame}–{selected.endFrame}{selected.locked?'; locked':''}</Text>
   <InOutRangeHandles scope={scope} revision={revision} showCommands={false} viewport={viewport} durationFrames={durationFrames} playheadFrame={frame} rate={rate} range={{inFrame:selected.startFrame,outFrame:selected.endFrame}} disabled={off||!!selected.locked} unstyled={unstyled}
    onCommit={range=>guard.run('range',(host,signal)=>{const sticker=host.stickers.find(s=>s.id===selected.id);if(!sticker||sticker.locked)return;if(range.inFrame===undefined||range.outFrame===undefined||range.inFrame>=range.outFrame)throw new Error('A sticker needs both range boundaries and at least one frame');return host.onRangeChange(sticker.id,{startFrame:range.inFrame,endFrame:range.outFrame},signal);})}/>
   {(['x','y','rotation','scale'] as const).map(key=><PrecisionScrubber key={key} scope={scope} revision={revision} label={'Sticker '+key} value={selected.transform[key]} min={key==='scale'?.01:key==='rotation'?-3600:-1e6} max={key==='scale'?100:key==='rotation'?3600:1e6} step={key==='scale'?.01:key==='rotation'?.1:1} disabled={off||!!selected.locked} unstyled={unstyled} onCommit={n=>edit({[key]:n})}/>)}
   <MotionKeyframeTimeline key={owner} {...keyframes} scope={scope} revision={String(revision)} frameRate={rate} disabled={off||!!selected.locked} unstyled={unstyled}
    onSelectionChange={selection=>guard.current()?.keyframes.onSelectionChange(selection)} onViewRangeChange={range=>guard.current()?.keyframes.onViewRangeChange(range)} onPlayheadChange={time=>guard.current()?.keyframes.onPlayheadChange(time)} onSnapChange={value=>guard.current()?.keyframes.onSnapChange(value)} onPreview={value=>guard.current()?.keyframes.onPreview?.(value)}
    onCommit={(curves,selection)=>{const host=guard.current();const live=host?.stickers.find(s=>s.id===selected.id);if(host&&live&&!live.locked)host.keyframes.onCommit(curves,selection);}}/>
   <Button title={'Remove '+selected.label} disabled={off||!!selected.locked} unstyled={unstyled} onPress={()=>guard.run('remove',(host,signal)=>host.stickers.some(s=>s.id===selected.id&&!s.locked)?host.onRemove(selected.id,signal):undefined)}/>
  </View>:<Text {...{className:unstyled?undefined:'text-text'}}>Select a sticker to edit its range, transform and motion</Text>}
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
