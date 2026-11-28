import {useRef} from 'react';
import {View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {CanvasNavigationDemo} from './CanvasNavigationDemo';
import {GpuCanvasDemo} from './GpuCanvasDemo';
export function CanvasWorkbenchDemo(){const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,mode=useStore(store,s=>s.mode);return <View style={{flex:1,gap:8}}><TabBar aria-label="Canvas examples" tabs={(['navigation','GPU'] as const).map(key=>({key,label:key,active:mode===key,onPress:()=>store.setState({mode:key})}))}/>{mode==='navigation'?<CanvasNavigationDemo/>:<GpuCanvasDemo/>}</View>;}
function makeStore(){return createStore<{mode:'navigation'|'GPU'}>(()=>({mode:'navigation'}));}
