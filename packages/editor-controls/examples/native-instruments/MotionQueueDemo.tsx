import {useRef} from 'react';
import {Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {Button} from '@nyc-tron/ui/components/Button';
import {RenderQueuePanel,type MotionRenderSettings,type MotionRenderJob} from '@nitro-forge/editor-controls/motion/RenderQueuePanel';
import {EasingPresetGallery,type MotionEasing} from '@nitro-forge/editor-controls/motion/EasingPresetGallery';
const settings:MotionRenderSettings={compositionId:'comp-a',formatId:'png-seq',profileId:'display-p3',destinationId:'exports',outputName:'Harbor',startFrame:0,endFrame:59,frameRate:{numerator:30000,denominator:1001},alpha:'straight',framePadding:6};
const formats=[{id:'png-seq',label:'PNG sequence',kind:'image-sequence' as const,supportsAlpha:true},{id:'mp4',label:'Opaque MP4',kind:'video' as const,supportsAlpha:false}];
const job=(id:string,status:MotionRenderJob['status'],renderSettings:MotionRenderSettings=settings):MotionRenderJob=>({id,label:id,settings:renderSettings,status,progress:status==='running'?{completedFrames:12,totalFrames:60}:null});
const makeStore=()=>createStore(()=>({nextJob:1,height:0,section:'Queue' as 'Queue'|'Easing',scope:'project-a',settings,jobs:[job('first','queued'),job('active','running'),job('second','queued')] as readonly MotionRenderJob[],selectedEasing:'linear' as string|null,easing:{kind:'linear'} as MotionEasing,preview:null as string|null,requests:[] as readonly string[],captured:null as MotionRenderSettings|null}));
/** Explicit fixture data and command reconciliation; no renderer is started or completion synthesized. */
export function MotionQueueDemo({deferred=false,spring=false}:{readonly deferred?:boolean;readonly spring?:boolean}){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s),transfer=useRef<(()=>void)|null>(null);
 return <View onLayout={event=>{const height=event.nativeEvent.layout.height;if(height!==store.getState().height)store.setState({height});}} style={{padding:16,gap:8,width:'100%',maxWidth:700,flex:1}}>
  <TabBar tabs={(['Queue','Easing'] as const).map(key=>({key,label:key,active:s.section===key,onPress:()=>store.setState({section:key})}))}/>
  {deferred?<Button title="Finish queue provider" onPress={()=>transfer.current?.()}/>:null}
  {s.section==='Queue'?<RenderQueuePanel scope={s.scope} value={s.settings} jobs={s.jobs} height={Math.max(100,Math.min(360,s.height-240))} compositions={[{id:'comp-a',label:'Harbor composition'}]} formats={formats} profiles={[{id:'display-p3',label:'Display P3 output'}]} destinations={[{id:'exports',label:'Selected export folder'}]} onChange={settings=>store.setState({settings})}
   onEnqueue={(value,signal)=>{if(!deferred){store.setState(s=>({captured:value,nextJob:s.nextJob+1,jobs:[...s.jobs,job(`new-render-${s.nextJob}`,'queued',value)],requests:[...s.requests,'enqueue']}));return;}return new Promise<void>(resolve=>{transfer.current=()=>{if(!signal.aborted)store.setState(s=>({captured:value,requests:[...s.requests,'enqueue']}));resolve();};});}}
   onCancelJob={id=>{store.setState(s=>({jobs:s.jobs.map(job=>job.id===id?{...job,status:'cancelled'}:job),requests:[...s.requests,`cancel ${id}`]}));}}
   onRemoveJob={id=>{store.setState(s=>({jobs:s.jobs.filter(job=>job.id!==id),requests:[...s.requests,`remove ${id}`]}));}}
   onReorder={ids=>{store.setState(s=>({jobs:ids.map(id=>s.jobs.find(job=>job.id===id)!),requests:[...s.requests,'reorder']}));}}/>:null}
  {s.section==='Easing'?<EasingPresetGallery scope={s.scope} selectedId={s.selectedEasing} supported={['hold','linear','bezier',...(spring?['spring' as const]:[])]} onSelect={preset=>store.setState({selectedEasing:preset.id,easing:preset.value})} onPreview={preset=>store.setState({preview:preset?.id??null})}/>:null}
  <Text numberOfLines={3} testID="motion-queue-state" accessibilityLabel={`Motion queue state ${JSON.stringify(s)}`} {...{className:'text-text'}}>{JSON.stringify(s)}</Text>
 </View>;
}
