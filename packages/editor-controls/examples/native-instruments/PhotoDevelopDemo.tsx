import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {RAWDevelopPanel} from '@nitro-forge/editor-controls/photo/RAWDevelopPanel';
import {RatingAndFlagControl} from '@nitro-forge/editor-controls/photo/RatingAndFlagControl';
import {defaultPhotoDevelop,serializePhotoDevelop,type PhotoRating,type PhotoDevelopSettings} from '@nitro-forge/editor-controls/photo/photo-adjustments';
const initial=()=>createStore(()=>({photoId:'harbor',revision:0,value:defaultPhotoDevelop(),rating:{stars:0,label:'none',flag:'none'} as PhotoRating,clipboard:serializePhotoDevelop({...defaultPhotoDevelop(),exposure:{...defaultPhotoDevelop().exposure,exposure:2.5}}),commits:0}));
/** Host-controlled settings fixture. Clipboard data is local to this demo; no RAW processing is simulated. */
export function PhotoDevelopDemo({invalid=false,deferred=false}:{readonly invalid?:boolean;readonly deferred?:boolean}){
 const local=useRef<ReturnType<typeof initial>|null>(null);local.current??=initial();const store=local.current,s=useStore(store,s=>s);
 const transfer=useRef<(()=>void)|null>(null);
 const commit=(value:PhotoDevelopSettings)=>store.setState(s=>({value,revision:s.revision+1,commits:s.commits+1}));
 return <ScrollView contentContainerStyle={{padding:16,gap:12,maxWidth:640,width:'100%'}}>
  <Text {...{className:'text-text'}}>Photo develop consumer: settings only</Text>
  <Button title="Switch photo" onPress={()=>store.setState(s=>({photoId:s.photoId==='harbor'?'portrait':'harbor',revision:0,value:defaultPhotoDevelop(),commits:0}))}/>
  {deferred?<Button title="Resolve pending paste" onPress={()=>transfer.current?.()}/>:null}
  <RatingAndFlagControl value={s.rating} onCommit={rating=>store.setState(s=>({rating,commits:s.commits+1}))}/>
  <RAWDevelopPanel photoId={s.photoId} revision={s.revision} value={s.value} defaults={defaultPhotoDevelop()} baseline={defaultPhotoDevelop()} profiles={[{id:'calibrated-50',label:'Calibrated 50 mm'}]} onCommit={commit}
   onCopy={payload=>{store.setState({clipboard:payload});}}
   onPaste={signal=>{const payload=invalid?'{invalid':s.clipboard;if(!deferred)return payload;return new Promise<string>((resolve,reject)=>{
    const finish=()=>{signal.removeEventListener('abort',abort);resolve(payload);};
    const abort=()=>{signal.removeEventListener('abort',abort);reject(new Error('Paste cancelled'));};
    transfer.current=finish;if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
   });}}/>
  <Text {...{className:'text-text'}} numberOfLines={3} testID="photo-state" accessibilityLabel={`Photo consumer state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </ScrollView>;
}
