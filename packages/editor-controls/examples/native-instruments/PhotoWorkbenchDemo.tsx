import {useRef} from 'react';
import {View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {PhotoDevelopDemo} from './PhotoDevelopDemo';
import {PhotoMasksDemo} from './PhotoMasksDemo';
import {PhotoWorkflowDemo} from './PhotoWorkflowDemo';
import {PhotoCatalogDemo} from './PhotoCatalogDemo';
const makeStore=()=>createStore(()=>({family:'Develop' as 'Develop'|'Catalog'|'Workflow'|'Masks'}));
export function PhotoWorkbenchDemo(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,family=useStore(store,s=>s.family);
 return <View style={{flex:1,gap:8}}><TabBar tabs={(['Develop','Catalog','Workflow','Masks'] as const).map(key=>({key,label:key,active:family===key,onPress:()=>store.setState({family:key})}))}/>{family==='Develop'?<PhotoDevelopDemo/>:family==='Catalog'?<PhotoCatalogDemo/>:family==='Workflow'?<PhotoWorkflowDemo/>:<PhotoMasksDemo/>}</View>;
}
