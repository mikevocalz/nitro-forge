import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ArtboardNavigator} from '@nitro-forge/editor-controls/layers/ArtboardNavigator';
import type {ArtboardItem} from '@nitro-forge/editor-controls/layers/artboard-model';
import {moveLayer} from '@nitro-forge/editor-controls/layers/layer-model';
const initial=():ArtboardItem[]=>['Page one','Page two','Page three'].map((name,index)=>({id:'page-'+index,name,x:index*400,y:0,w:300,h:200,revision:1}));
function makeStore(){return createStore(()=>({document:'a',boards:initial(),selected:'page-0' as string|undefined,nextId:3,layout:'list' as 'list'|'grid',disabled:false,hold:false,fail:false,pendingCount:0,events:[] as string[]}));}
export function ArtboardDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v),document=s.document,pending=useRef<(()=>void)[]>([]);
 const wait=(signal?:AbortSignal)=>new Promise<void>(resolve=>{const finish=()=>{pending.current=pending.current.filter(item=>item!==finish);signal?.removeEventListener('abort',finish);store.setState({pendingCount:pending.current.length});resolve();};pending.current.push(finish);signal?.addEventListener('abort',finish,{once:true});store.setState({pendingCount:pending.current.length});if(signal?.aborted)finish();});
 const perform=async(name:string,signal:AbortSignal|undefined,change:()=>void)=>{if(store.getState().hold)await wait(signal);if(signal?.aborted||store.getState().document!==document)return;if(store.getState().fail)throw new Error('Artboard operation failed');change();store.setState(v=>({events:[...v.events,document+':'+name].slice(-30)}));};
 return <ScrollView contentContainerStyle={{gap:8,padding:8}}><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
  <Button title="Replace artboard document" onPress={()=>store.setState(v=>({document:v.document==='a'?'b':'a',boards:initial(),selected:'page-0'}))}/><Button title="Toggle artboard editing" onPress={()=>store.setState(v=>({disabled:!v.disabled}))}/><Button title="Toggle artboard layout" onPress={()=>store.setState(v=>({layout:v.layout==='list'?'grid':'list'}))}/><Button title="Reverse artboards externally" onPress={()=>store.setState(v=>({boards:[...v.boards].reverse()}))}/>
  <Button title="Hold artboard requests" onPress={()=>store.setState(v=>({hold:!v.hold}))}/><Button title="Release artboard requests" onPress={()=>{for(const finish of [...pending.current])finish();}}/><Button title="Toggle artboard failure" onPress={()=>store.setState(v=>({fail:!v.fail}))}/>
 </View><ArtboardNavigator scope={document} artboards={s.boards} selectedId={s.selected} layout={s.layout} disabled={s.disabled} onSelect={selected=>{if(store.getState().document===document)store.setState(v=>({selected,events:[...v.events,document+':select:'+selected].slice(-30)}));}}
  onAddArtboard={(op,signal)=>perform('add',signal,()=>store.setState(v=>({boards:[...v.boards,{...op,id:'page-'+v.nextId,name:op.name??'Page',revision:1}],nextId:v.nextId+1})))}
  onUpdateArtboard={(op,signal)=>perform('rename:'+op.id,signal,()=>store.setState(v=>({boards:v.boards.map(board=>board.id===op.id?{...board,...op}:board)})))}
  onRemoveArtboard={(op,signal)=>perform('remove:'+op.id,signal,()=>store.setState(v=>{const boards=v.boards.filter(board=>board.id!==op.id);return {boards,selected:v.selected===op.id?boards[0]?.id:v.selected};}))}
  onMoveArtboard={(op,signal)=>perform('move:'+op.id,signal,()=>store.setState(v=>({boards:moveLayer(v.boards,op.id,op.to_index)})))}
  loadThumbnail={async()=>{const color=document==='a'?80:180,pixels=new Uint8Array(8*8*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=color;pixels[i+1]=color;pixels[i+2]=color;pixels[i+3]=255;}return {width:8,height:8,pixels};}}/>
 <Text testID="artboard-state" accessibilityLabel={'Artboard state '+JSON.stringify(s)}>{JSON.stringify(s)}</Text></ScrollView>;
}
