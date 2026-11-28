import {useRef} from 'react';
import {Platform,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ExpressionEditor,type ExpressionDiagnostic} from '@nitro-forge/editor-controls/motion/ExpressionEditor';
const references=[{id:'time',label:'Composition time',insertText:'time',detail:'Seconds reported by the composition host'},{id:'position',label:'Layer position',insertText:'layer("title").position',detail:'Host-defined layer reference'}];
const makeStore=()=>createStore(()=>({scope:'expression-a',revision:0,value:'ti',applies:0,applied:'',slow:false,reject:false,height:0}));
export function MotionExpressionDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v);const wait=()=>new Promise(resolve=>setTimeout(resolve,store.getState().slow?500:20));return <View style={{flex:1,padding:16,gap:6}} onLayout={event=>{const height=event.nativeEvent.layout.height;if(height!==store.getState().height)store.setState({height});}}>
 {Platform.OS==='web'?<View style={{gap:8}}>
 <Button title="Switch expression document" onPress={()=>store.setState(s=>({scope:s.scope==='expression-a'?'expression-b':'expression-a',revision:s.revision+1,value:'ti',applies:0,applied:''}))}/>
 <Button title={s.slow?'Use fast expression provider':'Use slow expression provider'} onPress={()=>store.setState({slow:!s.slow})}/>
 <Button title={s.reject?'Allow expression provider':'Reject expression provider'} onPress={()=>store.setState({reject:!s.reject})}/>
 </View>:null}
 <ExpressionEditor scope={s.scope} revision={s.revision} value={s.value} references={references} height={Platform.OS==='web'?200:Math.max(80,Math.min(200,s.height-440))} onChange={value=>store.setState({value})} onComplete={async(query,signal)=>{await wait();if(signal.aborted)return [];if(store.getState().reject)throw new Error('Completion provider unavailable');return [{id:'time',label:'Composition time',insertText:'time',range:{start:0,end:query.text.length},detail:'Replace the current fixture token'}];}} onValidate={async(text,signal)=>{await wait();if(signal.aborted)return [];if(store.getState().reject)throw new Error('Validation provider unavailable');const at=text.indexOf('unknown');return at>=0?[{id:'unknown',severity:'error',message:'Unknown fixture reference',range:{start:at,end:at+7}}] as readonly ExpressionDiagnostic[]:[];}} onApply={async(text,signal)=>{await wait();if(signal.aborted)return;if(store.getState().reject)throw new Error('Apply provider unavailable');store.setState(s=>({applies:s.applies+1,applied:text}));}}/>
 <Text {...{className:'text-text'}} testID="motion-expression-state" numberOfLines={3} accessibilityLabel={`Motion expression state ${JSON.stringify(s)}`}>{JSON.stringify(s)}</Text>
 </View>;}
