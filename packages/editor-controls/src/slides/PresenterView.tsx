import type {ReactNode} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface PresenterViewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 currentSlideLabel:string;nextSlideLabel:string|null;currentSurface:ReactNode;nextSurface:ReactNode;notes:ReactNode;aspectRatio:number;
 slideIndex:number;slideCount:number;clockLabel:string;elapsedMs:number;paused:boolean;blackout:boolean;
 onNavigate:(direction:-1|1,signal?:AbortSignal)=>unknown;onPauseChange:(paused:boolean,signal?:AbortSignal)=>unknown;onBlackoutChange:(blackout:boolean,signal?:AbortSignal)=>unknown;onEnd:(signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Presenter clock/elapsed values follow the host session. Surface/native playback resources stay above this layout. */
export function PresenterView({scope='presenter-view',revision=0,...props}:PresenterViewProps){
 const {currentSlideLabel,nextSlideLabel,currentSurface,nextSurface,notes,aspectRatio,slideIndex,slideCount,clockLabel,elapsedMs,paused,blackout,onNavigate:_navigate,onPauseChange:_pause,onBlackoutChange:_black,onEnd:_end,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(slideIndex)||!Number.isSafeInteger(slideCount)||slideIndex<0||slideCount<1||slideIndex>=slideCount||!Number.isFinite(elapsedMs)||elapsedMs<0||!Number.isFinite(aspectRatio)||aspectRatio<=0||aspectRatio>10||clockLabel.length>256||currentSlideLabel.length>1024)throw new RangeError('Invalid presenter session');
 const identity=JSON.stringify(controlIdentity(scope,revision)),guard=useScopedControl(JSON.stringify([identity,disabledReason]),props,disabledReason!==undefined),end=useScopedControl(identity,props),off=guard.pending||disabledReason!==undefined;
 const navigate=(d:-1|1)=>guard.run('navigate',(h,s)=>h.slideIndex+d>=0&&h.slideIndex+d<h.slideCount?h.onNavigate(d,s):undefined);
 return <View {...rest} accessibilityLabel="Presenter view" style={[{gap:10,minWidth:0},style]} {...{onKeyDown:(e:{nativeEvent:{key:string};preventDefault?:()=>void})=>{if(e.nativeEvent.key==='Escape'){guard.cancel();void end.run('end',(h,s)=>h.onEnd(s));e.preventDefault?.();}else if(!off&&['ArrowRight','PageDown','ArrowLeft','PageUp'].includes(e.nativeEvent.key)){e.preventDefault?.();void navigate(e.nativeEvent.key==='ArrowRight'||e.nativeEvent.key==='PageDown'?1:-1);}}}}>
 <Text {...{className:unstyled?undefined:'text-text'}}>{clockLabel} · elapsed {Math.floor(elapsedMs/60000)}:{Math.floor(elapsedMs/1000%60).toString().padStart(2,'0')} · slide {slideIndex+1}/{slideCount}</Text>
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}><View style={{flex:2,minWidth:160,gap:6}}><Text {...{className:unstyled?undefined:'text-text'}}>{currentSlideLabel}{blackout?' · Audience display blanked':''}</Text><View style={{aspectRatio,position:'relative',overflow:'hidden'}}>{currentSurface}</View></View><View style={{flex:1,minWidth:120,gap:6}}><Text {...{className:unstyled?undefined:'text-text'}}>{nextSlideLabel??'No next slide'}</Text><View style={{aspectRatio,overflow:'hidden'}}>{nextSurface}</View></View></View>
 <View accessibilityLabel="Speaker notes">{notes}</View><View style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}><Button title="Previous slide" disabled={off||slideIndex===0} unstyled={unstyled} onPress={()=>navigate(-1)}/><Button title="Next slide" disabled={off||slideIndex===slideCount-1} unstyled={unstyled} onPress={()=>navigate(1)}/><Button title={paused?'Resume presentation timer':'Pause presentation timer'} disabled={off} unstyled={unstyled} onPress={()=>guard.run('pause',(h,s)=>h.onPauseChange(!h.paused,s))}/><Button title={blackout?'Restore audience display':'Blank audience display'} disabled={off} unstyled={unstyled} onPress={()=>guard.run('blackout',(h,s)=>h.onBlackoutChange(!h.blackout,s))}/><Button title="End presentation" disabled={end.pending} variant="secondary" unstyled={unstyled} onPress={()=>{guard.cancel();return end.run('end',(h,s)=>h.onEnd(s));}}/></View><ErrorMessage {...exact({message:guard.error??end.error??disabledReason,unstyled:unstyled})}/></View>;
}
