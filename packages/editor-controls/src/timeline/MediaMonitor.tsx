import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {assertFrameRate,type FrameRate} from '../timebase.ts';
import {TransportControls} from './TransportControls.tsx';
import {TimecodeDisplay} from './TimecodeDisplay.tsx';
import {SeekBar} from './SeekBar.tsx';
import {SafeAreaOverlay,type SafeAreaOverlayProps} from './SafeAreaOverlay.tsx';
import {setMark,type InOutRange} from './edits.ts';
import {exact} from '../exact-optional.ts';
export interface MediaMonitorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 kind:'source'|'program';sourceId:string|null;label:string;frame:number;durationFrames:number;rate:FrameRate;playing:boolean;
 /** Last decoded frame actually presented, separate from the requested/clock frame. */
 presentedFrame?:number;status:'empty'|'loading'|'ready'|'error';error?:string;
 /** Actual native video/compositor surface owned by the consuming host. */
 surface:ReactNode;aspectRatio:number;overlays?:ReactNode;
 onPlayPause:(signal?:AbortSignal)=>void|Promise<unknown>;onStop:(signal?:AbortSignal)=>void|Promise<unknown>;
 onSeek:(frame:number,signal?:AbortSignal)=>void|Promise<unknown>;onScrub?:(frame:number)=>void;
 onOpenSource?:(signal?:AbortSignal)=>void|Promise<unknown>;
 range?:InOutRange;onRangeChange?:(range:InOutRange,signal?:AbortSignal)=>void|Promise<unknown>;
 safeArea?:Omit<SafeAreaOverlayProps,'aspect'>;unstyled?:boolean;
}
/** Shared monitor chrome. Surface/decoder lifetimes stay above source/program layouts. */
export function MediaMonitor({scope='media-monitor',revision=0,...props}:MediaMonitorProps){
 const {kind,sourceId,label,frame,durationFrames,rate,playing,presentedFrame,status,error,surface,aspectRatio,overlays,onPlayPause:_play,onStop:_stop,onSeek:_seek,onScrub,onOpenSource,range,onRangeChange,safeArea,unstyled=false,disabledReason,style,...rest}=props;
 assertFrameRate(rate);
 if(!label.trim()||label.length>1024||sourceId!==null&&(!sourceId.trim()||sourceId.length>512)||!Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(durationFrames)||durationFrames<0||presentedFrame!==undefined&&(!Number.isSafeInteger(presentedFrame)||presentedFrame<0)||!Number.isFinite(aspectRatio)||aspectRatio<=0||aspectRatio>10||!['empty','loading','ready','error'].includes(status))throw new RangeError('Invalid monitor state');
 const identity=JSON.stringify([...controlIdentity(scope,revision),sourceId,durationFrames,rate,disabledReason]);
 const owner=JSON.stringify([identity,status]);
 const openGuard=useScopedControl(identity,props,disabledReason!==undefined);
 const guard=useScopedControl(owner,props,disabledReason!==undefined||status!=='ready'||openGuard.pending),off=guard.pending||openGuard.pending||disabledReason!==undefined||status!=='ready';
 const seek=(value:number)=>guard.run('seek',(host,signal)=>host.onSeek(value,signal));
 const reason=disabledReason??(openGuard.pending?'Opening source media':guard.pending?'Player operation in progress':status==='loading'?'Loading media':status==='error'?(error??'Media could not be loaded'):status==='empty'?'Open media to begin':undefined);
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel={label}>
  <View style={{aspectRatio,position:'relative',overflow:'hidden',minHeight:120}}>
   {surface}{kind==='program'&&safeArea?<SafeAreaOverlay {...safeArea} aspect={aspectRatio} unstyled={unstyled}/>:null}{overlays}
  </View>
  <Text {...{className:unstyled?undefined:'text-text'}}>Presented frame: {presentedFrame===undefined?'Not reported':presentedFrame}</Text>
  <TimecodeDisplay key={owner} scope={scope} revision={revision} frame={frame} rate={rate} format="timecode" durationFrames={durationFrames} label={kind==='source'?'Source time':'Program time'} unstyled={unstyled} {...(off?{disabledReason:reason??'Player unavailable'}:{})} onCommit={seek}/>
  <SeekBar key={owner} scope={scope} revision={revision} frame={frame} rate={rate} durationFrames={durationFrames} disabled={off} unstyled={unstyled} onSeek={seek} {...(onScrub?{onScrub:(value:number)=>guard.current()?.onScrub?.(value)}:{})}/>
  <TransportControls key={owner} scope={scope} revision={revision} frame={frame} durationFrames={durationFrames} playing={playing} unstyled={unstyled} {...(reason?{disabledReason:reason}:{})}
   onSeek={seek} onPlayPause={()=>guard.run('play',(host,signal)=>host.onPlayPause(signal))} onStop={()=>guard.run('stop',(host,signal)=>host.onStop(signal))}/>
  {kind==='source'&&range&&onRangeChange?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
   <Button title="Mark source in" disabled={off} unstyled={unstyled} onPress={()=>guard.run('in',(host,signal)=>host.onRangeChange?.(setMark(host.range!,'in',host.frame,host.durationFrames),signal))}/>
   <Button title="Mark source out" disabled={off} unstyled={unstyled} onPress={()=>guard.run('out',(host,signal)=>host.onRangeChange?.(setMark(host.range!,'out',host.frame,host.durationFrames),signal))}/>
   <Button title="Clear source marks" disabled={off} variant="secondary" unstyled={unstyled} onPress={()=>guard.run('clear',(host,signal)=>host.onRangeChange?.({},signal))}/>
   <Text {...{className:unstyled?undefined:'text-text'}}>In: {range.inFrame??'Not set'}; out: {range.outFrame??'Not set'}</Text>
  </View>:null}
  {onOpenSource?<Button title="Open source media" disabled={guard.pending||openGuard.pending||disabledReason!==undefined} unstyled={unstyled} onPress={()=>openGuard.run('open',(host,signal)=>host.onOpenSource?.(signal))}/>:null}
  <ErrorMessage {...exact({message:guard.error??openGuard.error??(status==='error'?error:undefined)??undefined,unstyled:unstyled})}/>
 </View>;
}
