import {useRef} from 'react';
import {Platform,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {EffectStackAndInspector,type MotionEffect} from '@nitro-forge/editor-controls/motion/EffectStackAndInspector';
const effect=(id:string,label:string):MotionEffect=>({id,label,typeId:'blur',bypassed:false,favorite:false,presetId:null,presets:[{id:'soft',label:'Soft'}],parameters:[{id:'radius',label:'Blur radius',kind:'number',value:5,minimum:0,maximum:100,step:1},{id:'repeat',label:'Repeat edges',kind:'boolean',value:false},{id:'quality',label:'Blur quality',kind:'choice',value:'full',choices:[{id:'full',label:'Full'},{id:'draft',label:'Draft'}]},{id:'label',label:'Effect annotation',kind:'text',value:'',maxLength:200}]});
const initial=()=>[effect('a','Primary blur'),effect('b','Secondary blur')];
const makeStore=()=>createStore(()=>({scope:'composition-a',revision:0,effects:initial(),selected:'a' as string|null,commits:0,reject:false,slow:false,next:1,height:0}));
export function MotionEffectsDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v);return <View style={{flex:1,padding:16,gap:8}} onLayout={event=>{const height=event.nativeEvent.layout.height;if(height!==store.getState().height)store.setState({height});}}>
 {Platform.OS==='web'?<View style={{gap:8}}>
 <Button title="Switch effect document" onPress={()=>store.setState(s=>({scope:s.scope==='composition-a'?'composition-b':'composition-a',revision:s.revision+1,effects:initial(),selected:'a',commits:0}))}/>
 <Button title={s.reject?'Allow effect writes':'Reject effect writes'} onPress={()=>store.setState({reject:!s.reject})}/>
 <Button title={s.slow?'Use fast effect provider':'Use slow effect provider'} onPress={()=>store.setState({slow:!s.slow})}/>
 </View>:null}
 <EffectStackAndInspector scope={s.scope} revision={s.revision} effects={s.effects} selectedId={s.selected} onSelect={selected=>store.setState({selected})} availableEffects={[{id:'blur',label:'Blur'}]} height={Platform.OS==='web'?300:Math.max(100,Math.min(300,s.height-250))} onMutation={async(mutation,signal)=>{await new Promise(resolve=>setTimeout(resolve,store.getState().slow?500:20));if(signal.aborted)return;if(store.getState().reject)throw new Error('Effect provider rejected this edit');store.setState(s=>{let effects=s.effects;switch(mutation.type){case 'reorder':effects=mutation.ids.map(id=>s.effects.find(e=>e.id===id)!);break;case 'add':effects=[...effects,effect(`new${s.next}`,'Added blur')];break;case 'remove':effects=effects.filter(e=>e.id!==mutation.effectId);break;default:effects=effects.map(e=>{if(e.id!==mutation.effectId)return e;switch(mutation.type){case 'bypass':return {...e,bypassed:mutation.value};case 'favorite':return {...e,favorite:mutation.value};case 'reset':return {...effect(e.id,e.label),favorite:e.favorite,bypassed:e.bypassed};case 'preset':return {...e,presetId:mutation.presetId,parameters:e.parameters.map(p=>p.id==='radius'&&p.kind==='number'?{...p,value:12}:p)};case 'parameter':return {...e,presetId:null,parameters:e.parameters.map(p=>p.id===mutation.parameterId?{...p,value:mutation.value} as typeof p:p)};}return e;});}
 return {effects,revision:s.revision+1,commits:s.commits+1,next:s.next+(mutation.type==='add'?1:0)};});}}/>
 <Text {...{className:'text-text'}} testID="motion-effects-state" numberOfLines={3} accessibilityLabel={`Motion effects state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;}
