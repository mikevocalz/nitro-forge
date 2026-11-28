import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {SelectionBounds,type SelectionFrame} from '../selection/SelectionBounds.tsx';
import {validateSelectionFrame} from '../selection/selection-bounds-model.ts';
import {validateViewport,type CanvasViewport} from '../canvas/canvas-viewport.ts';
import type {Rect2D} from '@nyc-tron/ui/components/overlays/popover-position';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface MotionTrackingOverlayProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 frame:number;playing:boolean;viewport:CanvasViewport;usableRegions?:readonly Rect2D[];surface:ReactNode;seed:SelectionFrame;
 measurement:{frame:number;bounds:SelectionFrame;confidence:number}|null;
 tracking:{status:'idle'|'running'|'ready'|'lost'|'error';progress?:number;error?:string};
 onPreview?:(frame:number,bounds:SelectionFrame|undefined)=>void;
 onCorrect:(frame:number,bounds:SelectionFrame,signal?:AbortSignal)=>void|Promise<unknown>;
 onTrack:(direction:'forward'|'backward',frame:number,seed:SelectionFrame,signal?:AbortSignal)=>void|Promise<unknown>;
 onStop:()=>void;unstyled?:boolean;
}
/** Actual tracking measurements over the host frame, plus scoped manual correction. */
export function MotionTrackingOverlay({scope='motion-tracking',revision=0,...props}:MotionTrackingOverlayProps){
 const {frame,playing,viewport,usableRegions,surface,seed,measurement,tracking,onPreview:_preview,onCorrect:_correct,onTrack:_track,onStop,unstyled=false,disabledReason,style,...rest}=props;
 validateViewport(viewport);validateSelectionFrame(seed);if(measurement)validateSelectionFrame(measurement.bounds);
 if(!Number.isSafeInteger(frame)||frame<0||measurement!==null&&(!Number.isSafeInteger(measurement.frame)||measurement.frame<0||!Number.isFinite(measurement.confidence)||measurement.confidence<0||measurement.confidence>1)||!['idle','running','ready','lost','error'].includes(tracking.status)||tracking.progress!==undefined&&(!Number.isFinite(tracking.progress)||tracking.progress<0||tracking.progress>1))throw new RangeError('Invalid tracking measurement');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined||playing||tracking.status==='running';
 const current=measurement?.frame===frame?measurement:null;
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Motion tracking">
  <View style={{width:viewport.width,height:viewport.height,position:'relative'}}>{surface}
   <SelectionBounds key={JSON.stringify([owner,frame])} scope={scope} revision={revision} frame={current?.bounds??seed} viewport={viewport} {...(usableRegions?{usableRegions}:{})} disabled={off} unstyled={unstyled}
    onPreview={value=>{const host=guard.current();if(host?.frame===frame)host.onPreview?.(frame,value);}}
    onCommit={bounds=>guard.run('correct',(host,signal)=>host.frame===frame?host.onCorrect(frame,bounds,signal):undefined)}/>
  </View>
  <Text {...{className:unstyled?undefined:'text-text'}}>Frame {frame}: {current?`measured confidence ${(current.confidence*100).toFixed(1)}%`:'No measurement for this frame'}</Text>
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">Tracking: {tracking.status}{tracking.progress===undefined?'':`; ${(tracking.progress*100).toFixed(0)}%`}</Text>
  {tracking.status==='lost'?<Text {...{className:unstyled?undefined:'text-text'}}>Track lost. Pause, correct the bounds and track again.</Text>:null}
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}>{(['backward','forward'] as const).map(direction=><Button key={direction} title={'Track '+direction} disabled={off} unstyled={unstyled}
   onPress={()=>guard.run('track',(host,signal)=>host.onTrack(direction,host.frame,host.measurement?.frame===host.frame?host.measurement.bounds:host.seed,signal))}/>)}</View>
  {guard.pendingId==='track'||tracking.status==='running'?<Button title="Stop tracking" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onStop();}}/>:null}
  <ErrorMessage {...exact({message:guard.error??tracking.error??undefined,unstyled:unstyled})}/>
 </View>;
}
