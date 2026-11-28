import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {Button} from '@nyc-tron/ui/components/Button';
import {LocalMaskBrush,type PhotoMaskStroke} from '@nitro-forge/editor-controls/photo/LocalMaskBrush';
import {CleanupAndRetouchPanel,type PhotoRetouchStroke} from '@nitro-forge/editor-controls/photo/CleanupAndRetouchPanel';
import {LinearRadialGradientMask} from '@nitro-forge/editor-controls/photo/LinearRadialGradientMask';
import {LuminanceColorRangeMask} from '@nitro-forge/editor-controls/photo/LuminanceColorRangeMask';
import type {PhotoMaskBrushSettings,PhotoRetouchSettings,PhotoGradientMask,PhotoRangeMask} from '@nitro-forge/editor-controls/photo/photo-masks';
const size={width:400,height:240};
const makeStore=()=>createStore(()=>({section:'Brush' as 'Brush'|'Retouch'|'Gradient'|'Range',photoId:'a',revision:0,brush:{operation:'add',radius:12,feather:.5,flow:.8} as PhotoMaskBrushSettings,retouch:{method:'heal',radius:10,feather:.6,flow:1} as PhotoRetouchSettings,gradient:{geometry:{type:'linear',x0:80,y0:120,x1:320,y1:120},feather:1,invert:false,combine:'replace'} as PhotoGradientMask,range:{mode:'color',minimum:0,maximum:1,color:null,tolerance:.1,softness:.2,combine:'replace',invert:false} as PhotoRangeMask,strokes:[] as readonly (PhotoMaskStroke|PhotoRetouchStroke)[],previewPoints:0,gradientPreview:false,samples:0,commits:0}));
/** Records typed brush/gradient/range requests; blue marks visualize capture, not a heal or mask engine. */
export function PhotoMasksDemo({deferred=false}:{readonly deferred?:boolean}){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 const transfer=useRef<(()=>void)|null>(null);
 const background=<View style={{width:'100%',height:'100%',backgroundColor:'#687b8f'}}><Text {...{className:'text-text'}}>Generated test canvas</Text></View>;
 return <View style={{padding:16,gap:8,width:'100%',maxWidth:640,flex:1}}>
  <TabBar tabs={(['Brush','Retouch','Gradient','Range'] as const).map(key=>({key,label:key,active:s.section===key,onPress:()=>store.setState({section:key})}))}/>
  <Button title="Change mask photo" onPress={()=>store.setState(s=>({photoId:s.photoId==='a'?'b':'a',revision:0}))}/>
  {deferred?<Button title="Finish range read" onPress={()=>transfer.current?.()}/>:null}
  <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight:700}} contentContainerStyle={{gap:8}}>
   {s.section==='Brush'?<LocalMaskBrush photoId={s.photoId} revision={String(s.revision)} imageSize={size} value={s.brush} onChange={brush=>store.setState({brush})} onPreview={stroke=>store.setState({previewPoints:stroke?.points.length??0})} onStrokeCommit={stroke=>{store.setState(s=>({strokes:[...s.strokes,stroke],commits:s.commits+1,revision:s.revision+1}));}}>{background}</LocalMaskBrush>:null}
   {s.section==='Retouch'?<CleanupAndRetouchPanel photoId={s.photoId} revision={String(s.revision)} imageSize={size} value={s.retouch} onChange={retouch=>store.setState({retouch})} onStrokeCommit={stroke=>{store.setState(s=>({strokes:[...s.strokes,stroke],commits:s.commits+1,revision:s.revision+1}));}}>{background}</CleanupAndRetouchPanel>:null}
   {s.section==='Gradient'?<LinearRadialGradientMask scope={JSON.stringify([s.photoId,s.revision])} value={s.gradient} imageSize={size} width={320} onPreview={mask=>store.setState({gradientPreview:!!mask})} onCommit={gradient=>store.setState(s=>({gradient,commits:s.commits+1}))}>{background}</LinearRadialGradientMask>:null}
   {s.section==='Range'?<LuminanceColorRangeMask photoId={s.photoId} revision={String(s.revision)} imageSize={size} value={s.range} onChange={range=>store.setState(s=>({range,commits:s.commits+1,revision:s.revision+1}))} onSample={()=>{store.setState(s=>({samples:s.samples+1}));const result={luminance:.6,color:{profileId:'linear-display-p3',channels:[-.25,1.5,.2],alpha:1,preview:{r:0,g:255,b:80,alpha:1}}};return deferred?new Promise<typeof result>(resolve=>{transfer.current=()=>resolve(result);}):result;}}/>:null}
  </ScrollView>
  <Text numberOfLines={3} testID="mask-state" accessibilityLabel={`Photo mask consumer state ${JSON.stringify(s)}`} {...{className:'text-text'}}>{JSON.stringify(s)}</Text>
 </View>;
}
