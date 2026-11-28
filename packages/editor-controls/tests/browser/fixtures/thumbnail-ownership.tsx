import {useRef,useMemo} from 'react';
import {AppRegistry,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {LayerThumbnail} from '../../../src/layers/LayerThumbnail.tsx';
import {createThumbnailCache,type RasterPixels} from '../../../src/layers/layer-thumbnail-model.ts';
const raster=(color:readonly number[]):RasterPixels=>({width:1,height:1,pixels:new Uint8Array(color)});
function App(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),cache=useMemo(()=>createThumbnailCache(),[]),pending=useRef<((v:RasterPixels)=>void)|null>(null),repaired=useRef(false);
 const load=useMemo(()=>async(id:string)=>{store.setState(v=>({requests:[...v.requests,s.scope+':'+id]}));return s.scope==='a'?new Promise<RasterPixels>(resolve=>{pending.current=resolve;}):raster([40,80,180,255]);},[s.scope,store]);
 const invalid=useMemo(()=>async()=>repaired.current?raster([40,180,80,255]):{width:2,height:2,pixels:new Uint8Array(1)},[]);
 return <View style={{gap:12,padding:16}}><Button title="Replace thumbnail document" onPress={()=>store.setState({scope:'b'})}/><Button title="Resolve old thumbnail" onPress={()=>pending.current?.(raster([180,80,40,255]))}/><Button title="Repair thumbnail loader" onPress={()=>{repaired.current=true;}}/>
 <LayerThumbnail scope={s.scope} source={{kind:'loader',id:'reused-layer',revision:1,load}} cache={cache} width={80} height={80} label="Scoped preview"/>
 <LayerThumbnail scope="invalid" source={{kind:'loader',id:'broken-output',revision:1,load:invalid}} cache={cache} width={128} height={96} label="Malformed preview"/>
 <LayerThumbnail scope="compact" source={{kind:'loader',id:'broken-output',revision:1,load:invalid}} cache={cache} width={28} height={28} label="Small malformed preview"/>
 <Text testID="thumbnail-state">{JSON.stringify(s)}</Text></View>;
}
function makeStore(){return createStore(()=>({scope:'a',requests:[] as string[]}));}
AppRegistry.registerComponent('thumbnail-ownership',()=>App);AppRegistry.runApplication('thumbnail-ownership',{rootTag:document.getElementById('root')});
