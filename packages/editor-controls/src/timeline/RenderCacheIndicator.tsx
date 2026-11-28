import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface RenderCacheJob {id:string;label:string;state:'queued'|'rendering'|'ready'|'stale'|'error';completed?:number;total?:number;error?:string}
export interface RenderCacheIndicatorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 jobs:readonly RenderCacheJob[];quality:string;qualities:readonly {id:string;label:string;disabledReason?:string}[];
 onQualityChange:(quality:string,signal?:AbortSignal)=>void|Promise<unknown>;
 onInvalidate:(id:string,signal?:AbortSignal)=>void|Promise<unknown>;onRetry:(id:string,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function RenderCacheIndicator({scope='render-cache',revision=0,...props}:RenderCacheIndicatorProps){
 const {jobs,quality,qualities,onQualityChange:_quality,onInvalidate:_invalidate,onRetry:_retry,unstyled=false,disabledReason,style,...rest}=props;
 if(jobs.length>256||new Set(jobs.map(j=>j.id)).size!==jobs.length||jobs.some(j=>!j.id.trim()||j.id.length>512||!j.label.trim()||j.label.length>1024||!['queued','rendering','ready','stale','error'].includes(j.state)||j.completed!==undefined&&(!Number.isSafeInteger(j.completed)||j.completed<0||!Number.isSafeInteger(j.total)||j.total!<1||j.completed>j.total!))||qualities.length>64||new Set(qualities.map(q=>q.id)).size!==qualities.length)throw new RangeError('Invalid render cache state');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Render cache">
  <Select label="Preview quality" value={quality} options={qualities.map(q=>({value:q.id,label:q.label,disabled:q.disabledReason!==undefined}))} disabled={off} unstyled={unstyled}
   onValueChange={id=>guard.run('quality',(host,signal)=>host.qualities.some(q=>q.id===id&&q.disabledReason===undefined)?host.onQualityChange(id,signal):undefined)}/>
  {jobs.map(job=><View key={job.id} style={{gap:4}}>
   <Text {...{className:unstyled?undefined:'text-text'}}>{job.label}: {job.state}{job.completed===undefined?'':`; ${job.completed} of ${job.total}`}</Text>
   {job.error?<Text {...{className:unstyled?undefined:'text-text'}}>{job.error}</Text>:null}
   {job.state==='error'||job.state==='stale'?<Button title={'Rebuild '+job.label} disabled={off} unstyled={unstyled} onPress={()=>guard.run('retry',(host,signal)=>host.jobs.some(j=>j.id===job.id&&(j.state==='error'||j.state==='stale'))?host.onRetry(job.id,signal):undefined)}/>:null}
   {job.state==='ready'?<Button title={'Invalidate '+job.label} variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.run('invalidate',(host,signal)=>host.jobs.some(j=>j.id===job.id&&j.state==='ready')?host.onInvalidate(job.id,signal):undefined)}/>:null}
  </View>)}
  {jobs.length===0?<Text {...{className:unstyled?undefined:'text-text'}}>No render cache jobs</Text>:null}<ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
