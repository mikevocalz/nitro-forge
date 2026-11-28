import {AppRegistry,Pressable,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {SelectionMarquee} from "../../../src/selection/SelectionMarquee.tsx";
import {MagicSelectionControls,MagicWandCanvas,type SelectionEdgeRadii} from "../../../src/selection/MagicSelectionControls.tsx";
import {shapeBounds,type DocRect,type SelectRegionRequest,type SelectionMode,type SelectionTool} from "../../../src/selection/selection-model.ts";
import type {MagicWandSettings} from "../../../src/selection/magic-selection-model.ts";
import {ColorDropCanvasTarget} from "../../../src/canvas-tools/ColorDropCanvasTarget.tsx";
import {ReferenceImageBoard} from "../../../src/canvas-tools/ReferenceImageBoard.tsx";
import type {ReferenceImage} from "../../../src/canvas-tools/reference-board-model.ts";
import {GestureCustomizationPanel} from "../../../src/canvas-tools/GestureCustomizationPanel.tsx";
import {CANVAS_QUICK_ACTIONS,DEFAULT_GESTURE_MAP,TABLET_GESTURES,type GestureMap} from "../../../src/canvas-tools/gesture-map-model.ts";

// This fixture plays the editor: a tiny in-memory stand-in for the Prism
// selection, flood fill and history ops, so each callback lands as one
// undoable step the way the nitro-forge adapter will apply it.
const params=new URLSearchParams(location.search);
const view=params.get("view")??"marquee";
const DOC={width:800,height:500};
type Fill={x:number;y:number;color:string};
type Doc={selection:DocRect|undefined;fills:Fill[]};
type Host=Doc&{
  past:Doc[];log:string[];
  tool:SelectionTool;mode:SelectionMode;feather:number;
  wand:MagicWandSettings;radii:SelectionEdgeRadii;
  refs:ReferenceImage[];selectedRef:string|undefined;nextRef:number;
  gestures:GestureMap;panelOpen:boolean;
};
const useHost=create<Host>(()=>({
  selection:params.get("selected")==="1"?{x:160,y:120,w:320,h:200}:undefined,fills:[],past:[],log:[],
  tool:(params.get("tool") as SelectionTool)??"rect",mode:"replace",feather:0,
  wand:{tolerance:32,contiguous:true,sample:"composite"},radii:{grow:4,feather:8,smooth:0},
  refs:params.get("refs")==="0"?[]:[
    {id:"r1",label:"Skyline",imageWidth:1200,imageHeight:800,x:16,y:16,width:200,height:170,fit:"fit",opacity:1,locked:false,pinned:false,placement:"float"},
    {id:"r2",label:"Bridge study",imageWidth:600,imageHeight:900,x:0,y:0,width:160,height:160,fit:"crop",opacity:0.8,locked:false,pinned:false,placement:"side"},
  ],selectedRef:"r1",nextRef:3,
  gestures:DEFAULT_GESTURE_MAP,panelOpen:true,
}));
const note=(entry:string)=>useHost.setState(s=>({log:[...s.log,entry]}));
// One engine op = one undo step.
const apply=(entry:string,change:(d:Doc)=>Partial<Doc>)=>useHost.setState(s=>({
  ...change(s),past:[...s.past,{selection:s.selection,fills:s.fills}],log:[...s.log,entry],
}));
const union=(a:DocRect,b:DocRect)=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
  return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};};
const intersect=(a:DocRect,b:DocRect)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  const w=Math.min(a.x+a.w,b.x+b.w)-x,h=Math.min(a.y+a.h,b.y+b.h)-y;return w>0&&h>0?{x,y,w,h}:undefined;};
const combine=(old:DocRect|undefined,next:DocRect,mode:SelectionMode)=>
  mode==="replace"?next:mode==="add"?(old?union(old,next):next):mode==="intersect"?(old?intersect(old,next):undefined):old;
const selectRegion=(r:SelectRegionRequest)=>{
  const b=shapeBounds(r.shape);
  apply(`selectRegion ${r.shape.kind} ${r.mode} ${Math.round(b.w)}x${Math.round(b.h)}@${Math.round(b.x)},${Math.round(b.y)}${r.feather?" f"+r.feather:""}`,
    d=>({selection:combine(d.selection,b,r.mode)}));
};
const undo=()=>useHost.setState(s=>{
  const prev=s.past[s.past.length-1];
  return prev?{...prev,past:s.past.slice(0,-1),log:[...s.log,"undo"]}:{log:[...s.log,"nothing to undo"]};
});

// The document: a few flat shapes standing in for the artwork.
function Art({width,height,fills=[]}:{width:number;height:number;fills?:Fill[]}){
  const k=width/DOC.width;
  return <View style={{width,height,backgroundColor:"#f4efe6"}}>
    <View style={{position:"absolute",left:80*k,top:60*k,width:260*k,height:180*k,backgroundColor:"#3d6b8f",borderRadius:12*k}}/>
    <View style={{position:"absolute",left:420*k,top:200*k,width:220*k,height:220*k,backgroundColor:"#d9a441",borderRadius:110*k}}/>
    <View style={{position:"absolute",left:120*k,top:320*k,width:200*k,height:120*k,backgroundColor:"#7c4a63"}}/>
    {fills.map((f,i)=><View key={i} testID="fill-mark" style={{position:"absolute",left:f.x*k-10,top:f.y*k-10,width:20,height:20,
      borderRadius:10,backgroundColor:f.color,borderWidth:2,borderColor:"#ffffff"}}/>)}
  </View>;
}
function Photo({tone}:{tone:"sky"|"bridge"}){
  return <View style={{flex:1,width:"100%",height:"100%",backgroundColor:tone==="sky"?"#9cc3e4":"#c9b79c"}}>
    <View style={{position:"absolute",left:"10%",right:"10%",bottom:"10%",height:"40%",backgroundColor:tone==="sky"?"#2f4a63":"#5b4636"}}/>
    <View style={{position:"absolute",left:"60%",top:"12%",width:"18%",height:"18%",borderRadius:999,backgroundColor:"#f6e6a8"}}/>
  </View>;
}

function useCanvasSize(){
  const vw=typeof innerWidth==="number"?innerWidth:390;
  const width=Math.min(vw-32,640);
  return {width,height:Math.round(width*DOC.height/DOC.width)};
}
function Log(){
  const log=useHost(s=>s.log);
  return <View style={{flexDirection:"row",gap:8,alignItems:"center",flexWrap:"wrap"}}>
    <Pressable role="button" aria-label="Undo" onPress={undo} {...{className:"rounded-control border border-border bg-surface-raised"}}
      style={{minHeight:44,paddingHorizontal:14,justifyContent:"center"}}><Text {...{className:"text-text"}}>Undo</Text></Pressable>
    <Text testID="log" {...{className:"text-text-muted text-xs"}} style={{flex:1}}>{"log "+log.join(", ")}</Text>
  </View>;
}

function Marquee(){
  const s=useHost();
  const size=useCanvasSize();
  return <SelectionMarquee tool={s.tool} onToolChange={tool=>useHost.setState({tool})} mode={s.mode}
    onModeChange={mode=>useHost.setState({mode})} feather={s.feather} {...size}
    documentWidth={DOC.width} documentHeight={DOC.height} selectionBounds={s.selection}
    onSelectRegion={selectRegion}
    onSelectAll={()=>apply("selectAll",()=>({selection:{x:0,y:0,w:DOC.width,h:DOC.height}}))}
    onDeselect={()=>apply("deselect",()=>({selection:undefined}))}
    onInvertSelection={()=>apply("invertSelection",d=>({selection:d.selection?undefined:{x:0,y:0,w:DOC.width,h:DOC.height}}))}>
    <Art {...size}/>
  </SelectionMarquee>;
}
function Wand(){
  const s=useHost();
  const size=useCanvasSize();
  const wide=size.width>=600;
  return <View style={{flexDirection:wide?"row":"column",gap:16,alignItems:"flex-start"}}>
    <MagicWandCanvas settings={s.wand} mode={s.mode} currentLayerId={params.get("layer")==="0"?undefined:7}
      width={wide?Math.min(size.width,420):size.width} height={Math.round((wide?Math.min(size.width,420):size.width)*DOC.height/DOC.width)}
      documentWidth={DOC.width} documentHeight={DOC.height} selectionBounds={s.selection}
      onMagicWand={r=>apply(`magicWand ${r.x},${r.y} t${r.tolerance} ${r.contiguous?"contiguous":"global"} ${typeof r.sample==="string"?r.sample:"layer"+r.sample.layer} ${r.mode}`,
        d=>({selection:combine(d.selection,{x:Math.max(0,r.x-60),y:Math.max(0,r.y-40),w:120,h:80},r.mode)}))}>
      <Art width={wide?Math.min(size.width,420):size.width} height={Math.round((wide?Math.min(size.width,420):size.width)*DOC.height/DOC.width)}/>
    </MagicWandCanvas>
    <MagicSelectionControls testID="magic-controls" style={{width:wide?340:size.width}}
      settings={s.wand} onSettingsChange={wand=>{useHost.setState({wand});note(`settings t${wand.tolerance} ${wand.contiguous?"c":"g"} ${wand.sample}`);}}
      currentLayerName={params.get("layer")==="0"?undefined:"Ink"} hasSelection={s.selection!==undefined}
      radii={s.radii} onRadiiChange={radii=>useHost.setState({radii})}
      onModifySelection={r=>apply(`modifySelection ${r.op} ${r.radius}`,d=>({selection:d.selection&&(r.op==="feather"?d.selection:
        {x:d.selection.x-(r.op==="grow"?r.radius:-r.radius),y:d.selection.y-(r.op==="grow"?r.radius:-r.radius),
         w:d.selection.w+(r.op==="grow"?2:-2)*r.radius,h:d.selection.h+(r.op==="grow"?2:-2)*r.radius})}))}/>
  </View>;
}
function Drop(){
  const fills=useHost(s=>s.fills);
  const size=useCanvasSize();
  return <ColorDropCanvasTarget color="#c8553d" colorLabel="Coral" tolerance={32} contiguous {...size}
    documentWidth={DOC.width} documentHeight={DOC.height}
    disabledReason={params.get("locked")==="1"?"Fill needs an unlocked pixel layer":undefined}
    onChipPress={()=>note("chip pressed")}
    onFill={r=>apply(`floodFill ${r.x},${r.y} ${r.color} t${r.tolerance} ${r.contiguous?"contiguous":"global"}`,
      d=>({fills:[...d.fills,{x:r.x,y:r.y,color:r.color}]}))}>
    <Art {...size} fills={fills}/>
  </ColorDropCanvasTarget>;
}
function References(){
  const s=useHost();
  const vw=typeof innerWidth==="number"?innerWidth:390;
  const wide=vw>=700;
  const width=wide?Math.min(vw-32-168-12,560):vw-32;
  const height=Math.round(width*0.7);
  const patch=(id:string,p:Partial<ReferenceImage>)=>useHost.setState(h=>({refs:h.refs.map(r=>r.id===id?{...r,...p}:r)}));
  return <ReferenceImageBoard references={s.refs} selectedId={s.selectedRef} width={width} height={height}
    onSelect={id=>useHost.setState({selectedRef:id})}
    onUpdate={(id,p)=>{patch(id,p);note(`update ${id} ${Object.entries(p).map(([k,v])=>k+"="+(typeof v==="number"?Math.round(v*100)/100:v)).join(" ")}`);}}
    onAdd={()=>useHost.setState(h=>{const id="r"+h.nextRef;return {nextRef:h.nextRef+1,selectedRef:id,log:[...h.log,"add "+id],
      refs:[...h.refs,{id,label:"Study "+h.nextRef,imageWidth:800,imageHeight:600,x:40,y:40,width:180,height:150,fit:"fit",opacity:1,locked:false,pinned:false,placement:"float"}]};})}
    onRemove={id=>useHost.setState(h=>({refs:h.refs.filter(r=>r.id!==id),selectedRef:h.selectedRef===id?undefined:h.selectedRef,log:[...h.log,"remove "+id]}))}
    renderImage={r=><Photo tone={r.id==="r2"?"bridge":"sky"}/>}>
    <Art width={width} height={height}/>
  </ReferenceImageBoard>;
}
function Gestures(){
  const s=useHost();
  const gestures=[...TABLET_GESTURES.map(g=>g.id==="pencil-squeeze"?{...g,unavailableReason:"This pencil has no squeeze sensor"}:g),
    {id:"three-finger-swipe-up",label:"Three-finger swipe up",input:"touch" as const,reservedBy:"iPadOS opens the app switcher"}];
  if(!s.panelOpen)return <Pressable role="button" aria-label="Open gesture controls" onPress={()=>useHost.setState({panelOpen:true})}
    {...{className:"rounded-control border border-border bg-surface-raised"}} style={{minHeight:44,padding:12}}>
    <Text {...{className:"text-text"}}>Open gesture controls</Text></Pressable>;
  return <GestureCustomizationPanel gestures={gestures} actions={CANVAS_QUICK_ACTIONS} value={s.gestures} defaults={DEFAULT_GESTURE_MAP}
    style={{maxWidth:560,width:"100%"}}
    onSave={map=>{useHost.setState({gestures:map});note("save "+Object.entries(map.bindings).filter(([,g])=>g).map(([a,g])=>a+"="+g).join(" ")+` hold=${map.holdDelayS}`);}}
    onCancel={()=>{useHost.setState({panelOpen:false});note("cancel");}}/>;
}

function Fixture(){
  const log=useHost(s=>s.log);
  return <ScrollView testID="scroll" contentContainerStyle={{padding:16,gap:16,width:"100%",maxWidth:1000,alignSelf:"center"}}>
    {view==="marquee"?<Marquee/>:view==="wand"?<Wand/>:view==="drop"?<Drop/>:view==="reference"?<References/>:<Gestures/>}
    {view!=="gestures"?<Log/>:<Text testID="log" {...{className:"text-text-muted text-xs"}}>{"log "+log.join(", ")}</Text>}
  </ScrollView>;
}

document.documentElement.dataset.theme=params.get("theme")??"light";
document.documentElement.dir=params.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir,className:"bg-surface-sunken"}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("SelectionToolsAcceptance",()=>Root);
AppRegistry.runApplication("SelectionToolsAcceptance",{rootTag:document.getElementById("root")});
