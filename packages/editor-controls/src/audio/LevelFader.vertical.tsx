import {createAudioPreviewOwner,commitAudioPreview,audioGestureCurrent} from './audio-preview-owner.ts';
import {audioTargetSize} from './audio-chrome.ts';
import {useLayoutEffect,useRef} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {GestureDetector,useCompetingGestures,usePanGesture,useTapGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import type {LevelFaderLabels} from './LevelFader.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {assertFaderRange,clampGain,dbToGain,dragToGain,FADER_RANGES,formatDb,gainToPosition,stepGain,type FaderRange} from './level.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface NativeVerticalFaderProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 targetSize?:number;labels?:LevelFaderLabels|undefined;
 value:number;label:string;range?:FaderRange;length?:number;stepDb?:number;className?:string;
 onPreview?:(gain:number)=>void;onCommit:(gain:number,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Native RNGH fader with dB taper, fine travel, numeric gain and double-tap unity reset. */
export function NativeVerticalFader({scope='vertical-fader',revision=0,...props}:NativeVerticalFaderProps){
 const {value,label,range=FADER_RANGES.CHANNEL,length=180,stepDb=1,onPreview:_preview,onCommit:_commit,unstyled=false,targetSize,labels,disabledReason,style,...rest}=props;assertFaderRange(range);const target=audioTargetSize(targetSize);
 if(!Number.isFinite(stepDb)||stepDb<=0||!Number.isFinite(value)||value<0||value>dbToGain(range.maxDb)||!label.trim()||label.length>1024||!Number.isFinite(length)||length<64||length>2048)throw new RangeError('Invalid vertical fader');
 const owner=JSON.stringify([...controlIdentity(scope,revision),value,range,length,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),active=useRef<{owner:string;start:number;value:number}|null>(null),tapRejected=useRef(false);
 const previews=useRef<ReturnType<typeof createAudioPreviewOwner<number>>|null>(null);previews.current??=createAudioPreviewOwner();
 const committedOwner=useRef(owner);
 const cancel=()=>{if(committedOwner.current!==owner)return;active.current=null;store.setState({preview:null});previews.current!.clear(owner);};
 useLayoutEffect(()=>()=>previews.current!.clear(owner),[owner]);
 useLayoutEffect(()=>{committedOwner.current=owner;cancel();tapRejected.current=true;store.setState({draft:formatDb(value),dirty:false,error:null});},[owner,value,off]);
 const admitted=()=>committedOwner.current===owner&&!off&&!!guard.current();
 const commit=(gain:number)=>{if(!admitted())return Promise.resolve(false);store.setState({preview:null});return commitAudioPreview(previews.current!,owner,track=>guard.run('gain',(host,signal)=>track(()=>gain!==host.value?host.onCommit(gain,signal):undefined)));};
 const update=(dy:number)=>{if(!admitted())return;const a=active.current;if(!a||!audioGestureCurrent(a.owner,owner,off)||!guard.current())return;const next=dragToGain(a.start,-dy*(store.getState().fine ? .1 : 1),length-16,range);a.value=next;store.setState({preview:next});const host=guard.current();if(host?.onPreview)previews.current!.publish(owner,host.onPreview,host.value,next);};
 const pan=usePanGesture({enabled:!off,runOnJS:true,maxPointers:1,activeOffsetY:[-4,4],failOffsetX:[-8,8],
  onActivate:event=>{if(!admitted())return;active.current={owner,start:gainToPosition(value,range),value};update(event.translationY);},
  onUpdate:event=>update(event.translationY),onTouchesDown:event=>{if(admitted()&&event.numberOfTouches>1)cancel();},
  onDeactivate:event=>{if(!admitted())return;if(event.canceled){cancel();return;}update(event.translationY);const a=active.current;if(a?.owner!==owner)return;active.current=null;void commit(a.value);},onFinalize:event=>{if(admitted()&&event.canceled)cancel();},
 });
 const reset=()=>commit(clampGain(1,range));
 const doubleTap=useTapGesture({enabled:!off,runOnJS:true,numberOfTaps:2,maxDelay:300,maxDuration:250,maxDistance:12,
  onBegin:()=>{if(admitted())tapRejected.current=false;},onTouchesDown:event=>{if(!admitted())return;if(event.numberOfTouches!==1)tapRejected.current=true;},onActivate:()=>{if(!tapRejected.current)void reset();},
 });
 const gesture=useCompetingGestures(pan,doubleTap),shown=s.preview??value,position=gainToPosition(shown,range);
 const numeric=()=>{if(!admitted())return;const state=store.getState();if(!state.dirty||off)return;const text=state.draft.trim().replace(/dB$/i,'').trim().replaceAll('−','-');let gain:number;
  if(/^-?(?:inf|infinity|∞)$/i.test(text))gain=0;else{const db=Number(text);if(!text||!Number.isFinite(db)||db<range.minDb||db>range.maxDb){store.setState({error:labels?.invalidValue?.(range.minDb,range.maxDb)??`Enter ${range.minDb} to ${range.maxDb} dB, or -inf for silence`});return;}gain=dbToGain(db);}
  store.setState({dirty:false,error:null});void commit(gain);
 };
 const key=(event:{key?:string;shiftKey?:boolean;preventDefault?:()=>void})=>{if(off||!admitted())return;const direction=event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0;if(event.key==='Escape'){event.preventDefault?.();cancel();return;}if(direction){event.preventDefault?.();void commit(stepGain(value,direction as -1|1,event.shiftKey ? stepDb/10 : stepDb,range));}else if(event.key==='Home'){event.preventDefault?.();void commit(0);}else if(event.key==='End'){event.preventDefault?.();void commit(dbToGain(range.maxDb));}};
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:controlTokens.extent.field,maxWidth:'100%',alignItems:'center'},style]} accessibilityLabel={labels?.faderName?.(label)??label+' fader'}>
  <Text {...{className:unstyled?undefined:'text-text'}}>{label}</Text>
  <GestureDetector gesture={gesture} touchAction="pan-x" userSelect="none"><View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{disabled:off}}
   accessibilityValue={{min:0,max:100,now:position*100,text:formatDb(shown)}} accessibilityActions={[{name:'increment',label:labels?.raiseAction??'Raise gain'},{name:'decrement',label:labels?.lowerAction??'Lower gain'},{name:'reset',label:labels?.resetAction??'Reset to unity'}]}
   onAccessibilityAction={e=>{if(off)return;if(e.nativeEvent.actionName==='reset')void reset();else if(e.nativeEvent.actionName==='increment'||e.nativeEvent.actionName==='decrement')void commit(stepGain(value,e.nativeEvent.actionName==='increment'?1:-1,stepDb,range));}}
   {...{onKeyDown:key,focusable:!off}} style={{width:target,height:length,position:'relative',opacity:off ? tokens.opacity.disabled : 1}}>
   <View pointerEvents="none" {...{className:unstyled?undefined:'bg-surface-sunken border border-border'}} style={{position:'absolute',left:(target-tokens.spacing.fixedElement)/2,top:tokens.spacing.fixedElement,bottom:tokens.spacing.fixedElement,width:tokens.spacing.fixedElement}}/>
   <View pointerEvents="none" {...{className:unstyled?undefined:'bg-accent'}} style={{position:'absolute',left:(target-tokens.spacing.fixedElement)/2,bottom:tokens.spacing.fixedElement,width:tokens.spacing.fixedElement,height:position*(length-tokens.spacing.fixedGroup)}}/>
   <View pointerEvents="none" {...{className:unstyled?undefined:'bg-surface-raised border-2 border-accent'}} style={{position:'absolute',left:0,top:(1-position)*(length-tokens.spacing.fixedGroup),width:target,height:tokens.spacing.fixedGroup}}/>
  </View></GestureDetector>
  <TextInput accessibilityLabel={labels?.gainInput?.(label)??label+' gain decibels'} value={s.dirty?s.draft:formatDb(shown)} maxLength={64} editable={!off} onChangeText={draft=>{if(admitted())store.setState({draft,dirty:true,error:null});}} onSubmitEditing={numeric} onBlur={numeric} style={{minHeight:target,minWidth:controlTokens.extent.field,maxWidth:'100%',padding:tokens.spacing.fixedElement}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
  <View style={{flexDirection:'row',gap:tokens.spacing.fixedStack}}><Button targetSize={target} title="−" accessibilityLabel={labels?.lower?.(label,stepDb)??`Lower ${label} by ${stepDb} dB`} disabled={off} unstyled={unstyled} onPress={()=>commit(stepGain(value,-1,stepDb,range))}/><Button targetSize={target} title="+" accessibilityLabel={labels?.raise?.(label,stepDb)??`Raise ${label} by ${stepDb} dB`} disabled={off} unstyled={unstyled} onPress={()=>commit(stepGain(value,1,stepDb,range))}/></View>
  <Button targetSize={target} title={s.fine?(labels?.fineOn??'Fine on'):(labels?.fineOff??'Fine off')} accessibilityLabel={s.fine?(labels?.fineOnName??'Fine gain on'):(labels?.fineOffName??'Fine gain off')} variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>{if(admitted())store.setState({fine:!s.fine});}}/>
  <Button targetSize={target} title={labels?.reset??'Reset unity'} accessibilityLabel={labels?.resetName??'Reset gain to unity'} variant="ghost" disabled={off} unstyled={unstyled} onPress={reset}/>
  <ErrorMessage {...exact({message:s.error??guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
function makeStore(){return createStore(()=>({preview:null as number|null,fine:false,draft:'',dirty:false,error:null as string|null}));}
