import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {LayerStack} from "../../../src/layers/LayerStack.tsx";
import {LayerThumbnail} from "../../../src/layers/LayerThumbnail.tsx";
import {MaskThumbnailAndEditor} from "../../../src/layers/MaskThumbnailAndEditor.tsx";
import {ClipToggle} from "../../../src/layers/ClippingMaskControls.tsx";
import {ArtboardNavigator} from "../../../src/layers/ArtboardNavigator.tsx";
import {CanvasCompareView} from "../../../src/layers/CanvasCompareView.tsx";
import {Button} from "@nyc-tron/ui/components/Button";
import {resolveClipping} from "../../../src/layers/clipping-model.ts";
import {createThumbnailCache,type RasterPixels} from "../../../src/layers/layer-thumbnail-model.ts";
import type {MaskInfo,RefineDraft} from "../../../src/layers/mask-model.ts";
import type {ArtboardItem} from "../../../src/layers/artboard-model.ts";
import type {CompareMode,CompareSource} from "../../../src/layers/compare-model.ts";

// The host plays Prism: a tiny in-memory document whose ops mirror the engine's
// argument objects one to one, with one undo step per op.
type Layer={id:string;name:string;clipped:boolean;locked:boolean;visible:boolean;opacity:number;hue:number;
  revision:number;mask:MaskInfo|null;content:"disc"|"empty"|"broken"};
type Doc={layers:Layer[];artboards:ArtboardItem[]};
type Host=Doc&{past:Doc[];log:string[];selectedLayer:string;selectedArtboard:string;hasSelection:boolean;
  refine:RefineDraft;mode:CompareMode;split:number;overlay:number};

const params=new URLSearchParams(location.search);
const initialLayers:Layer[]=[
  {id:"shade",name:"Shade",clipped:true,locked:false,visible:true,opacity:0.6,hue:250,revision:1,mask:null,content:"disc"},
  {id:"tint",name:"Warm tint",clipped:true,locked:false,visible:true,opacity:0.8,hue:20,revision:1,
    mask:{enabled:true,inverted:false,revision:1},content:"disc"},
  {id:"photo",name:"Photo",clipped:false,locked:false,visible:true,opacity:1,hue:190,revision:1,mask:null,content:"disc"},
  {id:"blank",name:"Blank",clipped:false,locked:false,visible:true,opacity:1,hue:0,revision:1,mask:null,content:"empty"},
  {id:"broken",name:"Corrupt import",clipped:false,locked:true,visible:true,opacity:1,hue:0,revision:1,mask:null,content:"broken"},
  {id:"bg",name:"Background",clipped:false,locked:false,visible:true,opacity:1,hue:40,revision:1,mask:null,content:"disc"},
];
const initialBoards:ArtboardItem[]=[
  {id:"a1",name:"Phone",x:0,y:0,w:390,h:844,revision:1},
  {id:"a2",name:"Tablet",x:490,y:0,w:834,h:1194,revision:1},
  {id:"a3",name:"Desktop",x:1424,y:0,w:1440,h:900,revision:1},
];
const useHost=create<Host>(()=>({layers:initialLayers,artboards:initialBoards,past:[],log:[],
  selectedLayer:params.get("layer")??"tint",selectedArtboard:"a1",hasSelection:false,
  refine:{feather:0,grow:0},mode:(params.get("mode") as CompareMode)??"split",split:0.5,overlay:0.5}));
const op=(name:string,payload:unknown,mutate:(d:Doc)=>Doc)=>useHost.setState(s=>({
  past:[...s.past,{layers:s.layers,artboards:s.artboards}],...mutate({layers:s.layers,artboards:s.artboards}),
  log:[...s.log,name+" "+JSON.stringify(payload)]}));
const note=(entry:string)=>useHost.setState(s=>({log:[...s.log,entry]}));
const undo=()=>useHost.setState(s=>{
  const prev=s.past[s.past.length-1];
  return prev?{...prev,past:s.past.slice(0,-1),log:[...s.log,"undo"]}:{};
});
const editLayer=(id:string,f:(l:Layer)=>Layer)=>(d:Doc)=>({...d,layers:d.layers.map(l=>l.id===id?f(l):l)});
const editMask=(id:string,f:(m:MaskInfo)=>MaskInfo|null)=>editLayer(id,l=>({...l,mask:l.mask?f(l.mask):null}));

// Procedural pixels: a soft disc in the layer's hue on transparency.
const hsl=(h:number,s:number,l:number)=>{
  const a=s*Math.min(l,1-l),f=(n:number)=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  return [f(0)*255,f(8)*255,f(4)*255];
};
function disc(hue:number,w:number,h:number):RasterPixels{
  const px=new Uint8Array(w*h*4),[r,g,b]=hsl(hue,0.65,0.5);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const d=Math.hypot((x+0.5)/w-0.5,(y+0.5)/h-0.5)*2,i=(y*w+x)*4;
    px[i]=r!;px[i+1]=g!;px[i+2]=b!;px[i+3]=d<0.8?255:d<1?Math.round((1-d)/0.2*255):0;
  }
  return {width:w,height:h,pixels:px};
}
function maskPixels(inverted:boolean,w:number,h:number):RasterPixels{
  const px=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const v=Math.round(255*x/(w-1)),i=(y*w+x)*4;
    const g=inverted?255-v:v;px[i]=g;px[i+1]=g;px[i+2]=g;px[i+3]=255;
  }
  return {width:w,height:h,pixels:px};
}
function scene(w:number,h:number,hue:number,variant:number):RasterPixels{
  const px=new Uint8Array(w*h*4);
  const [r1,g1,b1]=hsl(hue,0.55,0.62),[r2,g2,b2]=hsl((hue+40)%360,0.6,0.3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const t=y/h,i=(y*w+x)*4;
    const sun=Math.hypot(x/w-0.7,y/h-0.3)<0.12+variant*0.05;
    const hill=y/h>0.62+0.08*Math.sin(x/w*6+variant);
    const c=sun?hsl(45,0.9,0.6+variant*0.1):hill?hsl((hue+120+variant*60)%360,0.4,0.35):[r1!*(1-t)+r2!*t,g1!*(1-t)+g2!*t,b1!*(1-t)+b2!*t];
    px[i]=c[0]!;px[i+1]=c[1]!;px[i+2]=c[2]!;px[i+3]=255;
  }
  return {width:w,height:h,pixels:px};
}
const delay=Number(params.get("delay")??60);
const wait=<T,>(value:()=>T)=>new Promise<T>(resolve=>setTimeout(()=>resolve(value()),delay));
const failures=new Map<string,number>();
const loadLayer=(id:string,max:number)=>{
  const l=useHost.getState().layers.find(x=>x.id===id);
  if(!l)return Promise.reject(new Error("No layer "+id));
  if(l.content==="broken"){
    failures.set(id,(failures.get(id)??0)+1);
    return new Promise<RasterPixels>((_,reject)=>setTimeout(()=>reject(new Error("Unsupported pixel format")),delay));
  }
  const edge=Math.min(max,24);
  return wait(()=>l.content==="empty"?{width:edge,height:edge,pixels:new Uint8Array(edge*edge*4)}:disc(l.hue,edge,edge));
};
const loadMask=(id:string,max:number)=>wait(()=>maskPixels(useHost.getState().layers.find(x=>x.id===id)?.mask?.inverted??false,
  Math.min(max,64),Math.min(max,48)));
const loadBoard=(id:string,max:number)=>{
  const a=useHost.getState().artboards.find(x=>x.id===id);
  if(!a)return Promise.reject(new Error("No artboard "+id));
  const s=Math.min(1,max/Math.max(a.w,a.h));
  return wait(()=>scene(Math.max(1,Math.round(a.w*s)),Math.max(1,Math.round(a.h*s)),
    {a1:200,a2:280,a3:150}[id as "a1"]??90,(a.revision??0)%3));
};
const before:CompareSource={kind:"pixels",raster:scene(480,320,205,0)};
const after:CompareSource={kind:"pixels",raster:scene(480,320,205,2)};
const cache=createThumbnailCache();
const pending=new Promise<RasterPixels>(()=>{});

function Layers(){
  const s=useHost();
  const roles=resolveClipping(s.layers);
  const rows=s.layers.map(l=>{
    const role=roles.get(l.id);
    return {id:l.id,name:l.name,visible:l.visible,opacity:l.opacity,locked:l.locked,kind:"raster" as const,
      ...(role?.kind==="clipped"?{clippedTo:role.baseName}:{}),
      thumbnail:{node:<LayerThumbnail cache={cache} source={{kind:"loader",id:l.id,revision:l.revision,load:loadLayer}}
        style={{borderWidth:0,borderRadius:0}}/>}};
  });
  const sel=s.layers.find(l=>l.id===s.selectedLayer)??s.layers[0]!;
  return <View style={{gap:12}}>
    <LayerStack testID="layer-stack" layers={rows} selectedId={s.selectedLayer} rowHeight={52}
      onSelect={id=>useHost.setState({selectedLayer:id})}
      onToggleVisible={id=>op("setLayerVisible",{id},editLayer(id,l=>({...l,visible:!l.visible})))}
      onOpacityCommit={(id,opacity)=>op("setLayerOpacity",{id,opacity},editLayer(id,l=>({...l,opacity})))}
      onMove={(id,to)=>op("moveLayer",{id,to},d=>{const l=d.layers.find(x=>x.id===id)!;const rest=d.layers.filter(x=>x.id!==id);
        rest.splice(to,0,l);return {...d,layers:rest};})}
      onRename={(id,name)=>op("renameLayer",{id,name},editLayer(id,l=>({...l,name})))}/>
    <ClipToggle layers={s.layers} layerId={sel.id}
      onSetClipped={p=>op("setClipped",p,editLayer(p.id,l=>({...l,clipped:p.clipped})))}/>
    <MaskThumbnailAndEditor testID="mask-editor" cache={cache} layerId={sel.id} layerName={sel.name} locked={sel.locked}
      mask={sel.mask} hasSelection={s.hasSelection} loadMaskThumbnail={loadMask}
      refineDraft={s.refine} onRefineDraftChange={refine=>{useHost.setState({refine});note("draft "+JSON.stringify(refine));}}
      onAddMask={p=>op("addMask",p,editLayer(p.id,l=>({...l,mask:{enabled:true,inverted:p.fill==="hide",revision:l.revision+1}})))}
      onRemoveMask={p=>op("removeMask",p,editLayer(p.id,l=>({...l,mask:null,revision:p.apply?l.revision+1:l.revision})))}
      onSetMaskEnabled={p=>op("setMaskEnabled",p,editMask(p.id,m=>({...m,enabled:p.enabled})))}
      onInvertMask={p=>op("invertMask",p,editMask(p.id,m=>({...m,inverted:!m.inverted,revision:m.revision+1})))}
      onRefineMask={p=>{op("refineMask",p,editMask(p.id,m=>({...m,revision:m.revision+1})));useHost.setState({refine:{feather:0,grow:0}});}}/>
  </View>;
}

function Boards({grid}:{grid:boolean}){
  const s=useHost();
  return <ArtboardNavigator testID="artboards" cache={cache} layout={grid?"grid":"list"} artboards={s.artboards}
    selectedId={s.selectedArtboard} loadThumbnail={loadBoard}
    onSelect={id=>{useHost.setState({selectedArtboard:id});note("select "+id);}}
    onAddArtboard={p=>op("addArtboard",p,d=>({...d,artboards:[...d.artboards,{id:"n"+(d.artboards.length+1),revision:1,
      name:p.name??"Artboard",x:p.x,y:p.y,w:p.w,h:p.h}]}))}
    onUpdateArtboard={p=>op("updateArtboard",p,d=>({...d,artboards:d.artboards.map(a=>a.id===p.id?{...a,...p}:a)}))}
    onRemoveArtboard={p=>op("removeArtboard",p,d=>({...d,artboards:d.artboards.filter(a=>a.id!==p.id)}))}
    onMoveArtboard={p=>op("moveArtboard",p,d=>{const a=d.artboards.find(x=>x.id===p.id)!;const rest=d.artboards.filter(x=>x.id!==p.id);
      rest.splice(p.to_index,0,a);return {...d,artboards:rest};})}/>;
}

function Compare(){
  const s=useHost();
  const missing=params.get("compare")==="missing";
  return <View style={{height:360}}>
    <CanvasCompareView testID="compare" before={missing?null:before} after={after} beforeLabel="Snapshot" afterLabel="Current"
      mode={s.mode} onModeChange={mode=>{useHost.setState({mode});note("mode "+mode);}}
      split={s.split} onSplitCommit={split=>{useHost.setState({split});note("split "+split);}}
      overlayOpacity={s.overlay} onOverlayOpacityCommit={overlay=>{useHost.setState({overlay});note("overlay "+overlay);}}/>
  </View>;
}

function ThumbnailStates(){
  const blank={width:4,height:4,pixels:new Uint8Array(64)};
  const cell=(text:string,node:JSX.Element)=><View style={{alignItems:"center",gap:4}}>
    {node}<Text {...{className:"text-text-muted text-xs"}}>{text}</Text>
  </View>;
  return <View testID="thumb-states" style={{flexDirection:"row",flexWrap:"wrap",gap:12,alignItems:"flex-end"}}>
    {cell("Ready",<LayerThumbnail label="Ready" width={56} height={56} source={{kind:"pixels",raster:disc(160,12,12)}}/>)}
    {cell("Loading",<LayerThumbnail label="Loading" width={56} height={56} cache={cache}
      source={{kind:"loader",id:"held",revision:1,load:()=>pending}}/>)}
    {cell("Empty",<LayerThumbnail label="Empty layer" width={56} height={56} source={{kind:"pixels",raster:blank}}/>)}
    {cell("Error",<LayerThumbnail label="Failed layer" width={120} height={90} cache={cache}
      source={{kind:"loader",id:"broken",revision:1,load:loadLayer}}/>)}
  </View>;
}

function Section({title,children}:{title:string;children:JSX.Element}){
  return <View style={{gap:8}}>
    <Text accessibilityRole="header" {...{className:"text-text font-semibold"}}>{title}</Text>
    {children}
  </View>;
}

function Fixture(){
  const log=useHost(s=>s.log);
  const canUndo=useHost(s=>s.past.length>0);
  const wide=typeof innerWidth==="number"&&innerWidth>=700;
  const only=params.get("only");
  const show=(name:string)=>!only||only===name;
  return <ScrollView {...{className:"bg-surface-raised"}} style={{flex:1}} contentContainerStyle={{padding:16,gap:20}}>
    <View style={{flexDirection:"row",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <Button title={canUndo?"Undo":"Undo, nothing to undo"} variant="secondary" disabled={!canUndo} onPress={undo}/>
      <Button title={useHost.getState().hasSelection?"Deselect":"Make selection"} variant="ghost"
        onPress={()=>useHost.setState(s=>({hasSelection:!s.hasSelection}))}/>
      <Button title="Paint on Photo" variant="ghost"
        onPress={()=>useHost.setState(s=>({layers:s.layers.map(l=>l.id==="photo"?{...l,hue:(l.hue+90)%360,revision:l.revision+1}:l)}))}/>
    </View>
    <Text testID="panel-log" {...{className:"text-text-muted text-xs"}}>{"log "+log.join(" | ")}</Text>
    <View style={{flexDirection:wide?"row":"column",gap:20,alignItems:"flex-start"}}>
      {show("layers")?<View style={{flex:wide?1:undefined,alignSelf:"stretch",gap:20,minWidth:0}}>
        <Section title="Layers"><Layers/></Section>
        <Section title="Thumbnail states"><ThumbnailStates/></Section>
      </View>:null}
      {show("boards")?<View style={{flex:wide?1:undefined,alignSelf:"stretch",gap:20,minWidth:0}}>
        <Section title="Artboards"><Boards grid={params.get("grid")==="1"||wide}/></Section>
        <Section title="Compare"><Compare/></Section>
      </View>:null}
    </View>
  </ScrollView>;
}

document.documentElement.dataset.theme=params.get("theme")??"light";
document.documentElement.dir=params.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("LayerPanelsAcceptance",()=>Root);
AppRegistry.runApplication("LayerPanelsAcceptance",{rootTag:document.getElementById("root")});
