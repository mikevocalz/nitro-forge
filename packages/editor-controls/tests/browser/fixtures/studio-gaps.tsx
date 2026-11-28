import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {LayerStack} from "../../../src/layers/LayerStack.tsx";
import {moveLayer,removeLayer,type LayerRow} from "../../../src/layers/layer-model.ts";

// Nitro Forge Design Studio gaps: LayerStack rows in docked panels of a given
// width (?w=320|360|390). The tab and select panes of this page stayed in
// NYC-Tron UI's packages/ui/tests/browser lane.
const initialLayers:LayerRow[]=[
  {id:"title",name:"Headline",visible:true,opacity:1,kind:"text"},
  {id:"badge",name:"Badge",visible:true,opacity:0.8,kind:"vector",kindLabel:"Ellipse",
    thumbnail:{fill:"#e0402a",label:"red fill"}},
  {id:"card",name:"Card background with a long name",visible:false,opacity:0.6,kind:"vector",kindLabel:"Rectangle",
    thumbnail:{fill:"#f4c430",label:"yellow fill"}},
  {id:"photo",name:"Skyline",visible:true,opacity:1,kind:"raster",kindLabel:"Raster",locked:true,
    thumbnail:{fill:"#3a6ea5",label:"skyline photo"}},
];
type Demo={layers:LayerRow[];previews:number;commits:string[]};
const useDemo=create<Demo>(()=>({layers:initialLayers,previews:0,commits:[]}));
const patch=(id:string,f:(l:LayerRow)=>LayerRow)=>useDemo.setState(s=>({layers:s.layers.map(l=>l.id===id?f(l):l)}));

const q=new URLSearchParams(location.search);
const width=Number(q.get("w")??390);

function Panel({title,width:w,children,testID,clip=true}:{title:string;width:number;children:React.ReactNode;testID?:string;clip?:boolean}){
  return <View testID={testID} {...{className:"rounded-card border border-border bg-surface-raised"}}
    style={{width:w,overflow:clip?"hidden":"visible",zIndex:clip?0:1}}>
    <Text {...{className:"text-text-muted text-xs"}} style={{paddingHorizontal:12,paddingVertical:8}}>{title}</Text>
    {children}
  </View>;
}

function Fixture(){
  const s=useDemo();
  return <ScrollView contentContainerStyle={{padding:16,gap:20,alignItems:"flex-start"}}>
    <Panel title={"Layers panel, "+width+" wide"} width={width} testID="layer-panel">
      <LayerStack layers={s.layers} selectedId="badge"
        onSelect={()=>{}}
        onToggleVisible={id=>patch(id,l=>({...l,visible:!l.visible}))}
        onOpacityPreview={()=>useDemo.setState(d=>({previews:d.previews+1}))}
        onOpacityCommit={(id,opacity)=>{patch(id,l=>({...l,opacity}));useDemo.setState(d=>({commits:[...d.commits,id+"="+opacity]}));}}
        onMove={(id,to)=>useDemo.setState(d=>({layers:moveLayer(d.layers,id,to)}))}
        onRename={(id,name)=>patch(id,l=>({...l,name}))}
        onRemove={id=>useDemo.setState(d=>({layers:removeLayer(d.layers,id)}))}/>
    </Panel>
    <Text testID="state" {...{className:"text-text-muted"}}>
      {"layers "+s.layers.map(l=>l.id+":"+l.opacity).join(",")+" previews "+s.previews+" commits "+s.commits.join(",")}
    </Text>
  </ScrollView>;
}
document.documentElement.dataset.theme=q.get("theme")??"light";
const dir=q.get("dir")==="rtl"?"rtl":"ltr";
document.documentElement.dir=dir;
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("StudioGaps",()=>Root);
AppRegistry.runApplication("StudioGaps",{rootTag:document.getElementById("root")});
