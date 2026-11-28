import {AppRegistry,ScrollView,Text,View} from 'react-native';import {create} from 'zustand';
// The audio interruption recovery half of NYC-Tron UI's media6 page (the
// browser decoding checks stayed in Tron's lane with @nyc-tron/platform-services).
import {Button} from '@nyc-tron/ui/components/Button';
import {AudioInterruptionRecoveryDialog} from '../../../src/audio/AudioInterruptionRecoveryDialog.tsx';
const useDoc=create<{dialog:'waiting'|'ready'|'output'|'reset'|'recording'|undefined;log:string;error:string}>(()=>({dialog:undefined,log:'',error:''}));
const log=(v:string)=>useDoc.setState({log:v});
function App(){const s=useDoc();return <ScrollView contentContainerStyle={{padding:16,gap:12}}>
 <Text>Audio recovery</Text>
 {(['waiting','ready','output','reset','recording'] as const).map(dialog=><Button key={dialog} title={'Show '+dialog} onPress={()=>useDoc.setState({dialog})}/>)}
 <Text testID="log">{s.log}</Text><Text testID="error">{s.error}</Text>
 {s.dialog==='recording'?<AudioInterruptionRecoveryDialog visible notice={{kind:'recording',filename:'Take 3.wav'}} onKeep={()=>log('keep')} onDiscard={()=>log('discard')} onClose={()=>useDoc.setState({dialog:undefined})}/>:
 s.dialog==='reset'?<AudioInterruptionRecoveryDialog visible notice={{kind:'reset'}} onRetry={()=>log('restart')} onStop={()=>log('stop')} onClose={()=>useDoc.setState({dialog:undefined})}/>:
 s.dialog?<AudioInterruptionRecoveryDialog visible notice={{kind:'paused',reason:s.dialog==='output'?'output-lost':'interruption',ready:s.dialog!=='waiting'}} onResume={()=>{if(q.has('fail'))throw new Error('Output still unavailable');log('resume');}} onStop={()=>log('stop')} onClose={()=>useDoc.setState({dialog:undefined})}/>:null}
 </ScrollView>;}
const q=new URLSearchParams(location.search);document.documentElement.dataset.theme=q.get('theme')??'light';document.documentElement.dir=q.get('dir')??'ltr';document.body.style.margin='0';AppRegistry.registerComponent('media6',()=>App);AppRegistry.runApplication('media6',{rootTag:document.getElementById('root')});
