import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {Button} from "@nyc-tron/ui/components/Button";
import {LayerStack} from "../../src/layers/LayerStack.tsx";
import {moveLayer,removeLayer,type LayerRow} from "../../src/layers/layer-model.ts";
import {NativeSeekBar} from "../../src/NativeSeekBar.web.tsx";
import {FRAME_RATES} from "../../src/timebase.ts";

// NativeSeekBar and LayerStack, the editor-control half of NYC-Tron UI's root
// fixture (PrecisionScrubber and DragGrabHandle stayed in Tron's lane).
type Demo={frame:number;seekPreviews:number;seekCommits:number};
const useDemo=create<Demo>(()=>({frame:120,seekPreviews:0,seekCommits:0}));
// Prism-style document: the fills are layer content, not theme colours.
const initialLayers:LayerRow[]=[
  {id:"title",name:"Headline",visible:true,opacity:1,kind:"text"},
  {id:"badge",name:"Badge",visible:true,opacity:0.8,kind:"vector",kindLabel:"Ellipse",
    thumbnail:{fill:"#e0402a",label:"red fill"}},
  {id:"card",name:"Card background",visible:false,opacity:0.6,kind:"vector",kindLabel:"Rectangle",
    thumbnail:{fill:"#f4c430",label:"yellow fill"}},
  {id:"photo",name:"Skyline",visible:true,opacity:1,kind:"raster",kindLabel:"Raster",locked:true,
    thumbnail:{node:<View style={{width:"100%",height:"100%",backgroundColor:"#3a6ea5"}}>
      <View style={{position:"absolute",bottom:0,left:4,width:6,height:14,backgroundColor:"#1d2b3a"}}/>
      <View style={{position:"absolute",bottom:0,left:12,width:8,height:20,backgroundColor:"#1d2b3a"}}/>
    </View>,label:"skyline photo"}},
];
type Removed={row:LayerRow;index:number};
const useLayers=create<{layers:LayerRow[];selected:string|undefined;undo:Removed[]}>(()=>({
  layers:initialLayers,selected:"badge",undo:[],
}));
const patch=(id:string,f:(l:LayerRow)=>LayerRow)=>useLayers.setState(s=>({layers:s.layers.map(l=>l.id===id?f(l):l)}));

function LayerPanel(){
  const layers=useLayers(s=>s.layers);
  const selected=useLayers(s=>s.selected);
  const undo=useLayers(s=>s.undo);
  return <View style={{gap:8}}>
    <LayerStack layers={layers} selectedId={selected}
      onSelect={id=>useLayers.setState({selected:id})}
      onToggleVisible={id=>patch(id,l=>({...l,visible:!l.visible}))}
      onOpacityCommit={(id,opacity)=>patch(id,l=>({...l,opacity}))}
      onMove={(id,to)=>useLayers.setState(s=>({layers:moveLayer(s.layers,id,to)}))}
      onRename={(id,name)=>patch(id,l=>({...l,name}))}
      onRemove={id=>useLayers.setState(s=>({layers:removeLayer(s.layers,id),
        undo:[...s.undo,{row:s.layers.find(l=>l.id===id)!,index:s.layers.findIndex(l=>l.id===id)}],
        selected:s.selected===id?undefined:s.selected}))}/>
    <View style={{flexDirection:"row",alignItems:"center",gap:12}}>
      <Button variant="secondary" size="sm" title="Undo remove" disabled={undo.length===0}
        onPress={()=>useLayers.setState(s=>{
          const last=s.undo.at(-1);
          if(!last)return s;
          const next=[...s.layers];next.splice(last.index,0,last.row);
          return {layers:next,undo:s.undo.slice(0,-1)};
        })}/>
      <Text testID="layers" {...{className:"text-text-muted"}}>{"layers "+layers.map(l=>l.id).join(",")}</Text>
    </View>
  </View>;
}
function Seek(){
  const frame=useDemo(s=>s.frame);
  return <NativeSeekBar testID="seek" frame={frame} durationFrames={240} frameRate={FRAME_RATES.FILM_24}
    onPreview={()=>useDemo.setState(s=>({seekPreviews:s.seekPreviews+1}))}
    onCommit={next=>useDemo.setState(s=>({frame:next,seekCommits:s.seekCommits+1}))}/>;
}

function Fixture(){
  const frame=useDemo(s=>s.frame);
  const seekPreviews=useDemo(s=>s.seekPreviews);
  const seekCommits=useDemo(s=>s.seekCommits);
  return <ScrollView contentContainerStyle={{padding:16,gap:24,maxWidth:560,width:"100%",alignSelf:"center"}}>
    <Seek/>
    <LayerPanel/>
    <View style={{gap:4}}>
      <Text testID="frame" {...{className:"text-text-muted"}}>{"frame "+frame}</Text>
      <Text testID="seek-log" {...{className:"text-text-muted"}}>{"seek "+seekPreviews+"/"+seekCommits}</Text>
    </View>
  </ScrollView>;
}
const query=new URLSearchParams(location.search);
document.documentElement.dataset.theme=query.get("theme")??"light";
document.documentElement.dir=query.get("dir")==="rtl"?"rtl":"ltr";
// React Native Web resolves start/end styles from a `dir` on an ancestor View,
// the way an RTL app sets it, not from the document's dir attribute.
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("EditorControlsAcceptance",()=>Root);
AppRegistry.runApplication("EditorControlsAcceptance",{rootTag:document.getElementById("root")});
