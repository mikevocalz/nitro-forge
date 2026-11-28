import {useRef,useLayoutEffect} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface RehearsalTimersProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 status:'idle'|'running'|'paused'|'finished';elapsedMs:number;activeSlideElapsedMs:number;activeSlideLabel:string;
 timings:readonly {slideId:string;label:string;durationMs:number}[];
 onAction:(action:'start'|'pause'|'resume'|'finish'|'reset'|'save',signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function RehearsalTimers({scope='rehearsal-timers',revision=0,...props}:RehearsalTimersProps){
 const {status,elapsedMs,activeSlideElapsedMs,activeSlideLabel,timings,onAction:_action,unstyled=false,disabledReason,style,...rest}=props;
 if(!['idle','running','paused','finished'].includes(status)||![elapsedMs,activeSlideElapsedMs].every(n=>Number.isFinite(n)&&n>=0&&n<=1e12)||timings.length>100000||timings.some(t=>!t.slideId.trim()||t.slideId.length>256||t.label.length>1024||!Number.isFinite(t.durationMs)||t.durationMs<0||t.durationMs>1e12))throw new RangeError('Invalid rehearsal timings');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,confirm=useStore(store,s=>s.confirm);useLayoutEffect(()=>{store.setState({confirm:false});},[owner]);
 const action=(value:Parameters<RehearsalTimersProps['onAction']>[0])=>guard.run(value,(h,s)=>{const allowed=value==='start'?h.status==='idle':value==='pause'?h.status==='running':value==='resume'?h.status==='paused':value==='finish'?h.status==='running'||h.status==='paused':value==='save'?h.status==='finished'&&h.timings.length>0:h.status!=='running';if(!allowed)throw new Error('Rehearsal command is unavailable in the current state');return h.onAction(value,s);}),total=timings.reduce((sum,t)=>sum+t.durationMs,0);
 return <View {...rest} accessibilityLabel="Rehearsal timings" style={[{gap:tokens.spacing.fixedElement},style]}><Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>Rehearsal {status} · elapsed {(elapsedMs/1000).toFixed(1)} s · {activeSlideLabel}: {(activeSlideElapsedMs/1000).toFixed(1)} s</Text><Text {...{className:unstyled?undefined:'text-text-muted'}}>Recorded {timings.length} slide timings · total {(total/1000).toFixed(1)} s</Text>
 <View style={{flexDirection:'row',gap:tokens.spacing.off6,flexWrap:'wrap'}}><Button title={status==='paused'?'Resume rehearsal':status==='running'?'Pause rehearsal':'Start rehearsal'} disabled={off||status==='finished'} unstyled={unstyled} onPress={()=>action(status==='paused'?'resume':status==='running'?'pause':'start')}/><Button title="Finish rehearsal" disabled={off||status==='idle'||status==='finished'} unstyled={unstyled} onPress={()=>action('finish')}/><Button title="Save recorded slide timings" disabled={off||status!=='finished'||timings.length===0} unstyled={unstyled} onPress={()=>action('save')}/><Button title="Reset rehearsal timings" variant="secondary" disabled={off||status==='running'} unstyled={unstyled} onPress={()=>store.setState({confirm:true})}/></View>
 {confirm?<View style={{gap:tokens.spacing.off6}}><Text {...{className:unstyled?undefined:'text-text'}}>Discard these recorded timings?</Text><Button title="Confirm reset rehearsal" variant="danger" disabled={off} unstyled={unstyled} onPress={async()=>{if(await action('reset'))store.setState({confirm:false});}}/><Button title="Keep timings" variant="secondary" unstyled={unstyled} onPress={()=>store.setState({confirm:false})}/></View>:null}
 <FlatList data={timings} keyExtractor={(t,index)=>t.slideId+':'+index} initialNumToRender={8} windowSize={5} style={{maxHeight:controlTokens.extent.list}} renderItem={({item})=><Text {...{className:unstyled?undefined:'text-text'}} style={{paddingVertical:tokens.spacing.fixedElement}}>{item.label}: {(item.durationMs/1000).toFixed(2)} s</Text>}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(){return createStore(()=>({confirm:false}));}
