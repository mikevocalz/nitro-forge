import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {MaskThumbnailAndEditor} from '@nitro-forge/editor-controls/layers/MaskThumbnailAndEditor';
import {ClipToggle} from '@nitro-forge/editor-controls/layers/ClippingMaskControls';
import type {ClipLayer} from '@nitro-forge/editor-controls/layers/clipping-model';
import type {MaskInfo,RefineDraft} from '@nitro-forge/editor-controls/layers/mask-model';
const clips=(document:string):ClipLayer[]=>[{id:'group',name:'Artwork',clipped:false},{id:'top',name:'Rectangle',clipped:false,parentId:'group'},{id:'base',name:document==='a'?'Base A':'Base B',clipped:false,parentId:'group'},{id:'outside',name:'Outside',clipped:false}];
function makeStore(){return createStore(()=>({document:'a',mask:{enabled:true,inverted:false,revision:1} as MaskInfo|null,refine:{feather:0,grow:0} as RefineDraft,clips:clips('a'),locked:false,disabled:false,hasSelection:false,hold:false,holdThumbnails:false,pendingCount:0,fail:false,events:[] as string[]}));}
export function MaskClipDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v),document=s.document,pending=useRef<(()=>void)[]>([]);
 const wait=(signal?:AbortSignal)=>new Promise<void>(resolve=>{const finish=()=>{pending.current=pending.current.filter(item=>item!==finish);signal?.removeEventListener('abort',finish);store.setState({pendingCount:pending.current.length});resolve();};pending.current.push(finish);signal?.addEventListener('abort',finish,{once:true});store.setState({pendingCount:pending.current.length});if(signal?.aborted)finish();});
 const perform=async(name:string,signal:AbortSignal|undefined,change:()=>void)=>{if(store.getState().hold)await wait(signal);if(signal?.aborted||store.getState().document!==document)return;if(store.getState().fail)throw new Error('Mask operation failed');change();store.setState(v=>({events:[...v.events,document+':'+name].slice(-30)}));};
 return <ScrollView contentContainerStyle={{gap:8,padding:8}}><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
  <Button title="Replace mask document" onPress={()=>store.setState(v=>{const document=v.document==='a'?'b':'a';return {document,mask:{enabled:true,inverted:false,revision:1},clips:clips(document),refine:{feather:0,grow:0}};})}/>
  <Button title="Toggle mask locking" onPress={()=>store.setState(v=>({locked:!v.locked,clips:v.clips.map(layer=>layer.id==='group'?{...layer,locked:!v.locked}:layer)}))}/>
  <Button title="Toggle mask editing" onPress={()=>store.setState(v=>({disabled:!v.disabled}))}/><Button title="Hold mask thumbnails" onPress={()=>store.setState(v=>({holdThumbnails:!v.holdThumbnails}))}/><Button title="Hold mask requests" onPress={()=>store.setState(v=>({hold:!v.hold}))}/>
  <Button title="Release mask requests" onPress={()=>{for(const finish of [...pending.current])finish();}}/><Button title="Toggle mask failure" onPress={()=>store.setState(v=>({fail:!v.fail}))}/><Button title="Toggle pixel selection" onPress={()=>store.setState(v=>({hasSelection:!v.hasSelection}))}/>
 </View>
 <MaskThumbnailAndEditor scope={document} layerId="top" layerName="Rectangle" locked={s.locked} disabled={s.disabled} mask={s.mask} hasSelection={s.hasSelection} refineDraft={s.refine} onRefineDraftChange={refine=>store.setState({refine})}
  loadMaskThumbnail={async()=>{if(store.getState().holdThumbnails)await wait();const color=document==='a'?80:180,pixels=new Uint8Array(8*8*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=color;pixels[i+1]=color;pixels[i+2]=color;pixels[i+3]=255;}return {width:8,height:8,pixels};}}
  onAddMask={(op,signal)=>perform('add:'+op.fill,signal,()=>store.setState({mask:{enabled:true,inverted:false,revision:1}}))}
  onRemoveMask={(op,signal)=>perform(op.apply?'apply':'delete',signal,()=>store.setState({mask:null}))}
  onSetMaskEnabled={(op,signal)=>perform('enabled',signal,()=>store.setState(v=>({mask:v.mask?{...v.mask,enabled:op.enabled}:null})))}
  onInvertMask={(_,signal)=>perform('invert',signal,()=>store.setState(v=>({mask:v.mask?{...v.mask,inverted:!v.mask.inverted,revision:v.mask.revision+1}:null})))}
  onRefineMask={(_,signal)=>perform('refine',signal,()=>store.setState(v=>({mask:v.mask?{...v.mask,revision:v.mask.revision+1}:null,refine:{feather:0,grow:0}})))}/>
 <ClipToggle scope={document} layers={s.clips} layerId="top" disabled={s.disabled} onSetClipped={(op,signal)=>perform('clip',signal,()=>store.setState(v=>({clips:v.clips.map(layer=>layer.id===op.id?{...layer,clipped:op.clipped}:layer)})))}/>
 <Text testID="mask-clip-state" accessibilityLabel={'Mask clip state '+JSON.stringify(s)}>{JSON.stringify(s)}</Text></ScrollView>;
}
