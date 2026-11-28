import {useRef} from 'react';
import {Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {ColorDiscPicker} from '@nitro-forge/editor-controls/color/ColorDiscPicker';
import {DisplayP3DiscLayer} from '@nyc-tron/native-controls/DisplayP3DiscLayer';

const makeStore=()=>createStore(()=>({value:{h:0,s:1,v:1,alpha:1},commits:0}));
/** Independent native consumer: editing P3-relative HSV, not converting an sRGB document. */
export function P3DiscDemo(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();
 const store=local.current,state=useStore(store,s=>s);
 return <View style={{padding:16,gap:12}}>
  <Text style={{color:'white'}}>Display P3 hue and saturation</Text>
  <Text style={{color:'white'}}>Native P3 rendering; output gamut depends on the display and host color mode.</Text>
  <ColorDiscPicker value={state.value} onCommit={value=>store.setState(s=>({value,commits:s.commits+1}))}
   renderDisc={({size,value})=><DisplayP3DiscLayer size={size} value={value.v}/>}/>
  <Text accessibilityLabel={`P3 document hue ${state.value.h}, saturation ${state.value.s}, brightness ${state.value.v}, commits ${state.commits}`} style={{color:'white'}}>
   {JSON.stringify(state)}
  </Text>
 </View>;
}
