import {useRef} from "react";
import {AppRegistry,PanResponder,Pressable,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {CanvasRuler} from "../../../src/canvas/CanvasRuler.tsx";
import {SnapGridOverlay} from "../../../src/canvas/SnapGridOverlay.tsx";
import {SnapGridSettings} from "../../../src/canvas/SnapGridSettings.tsx";
import {SmartGuides} from "../../../src/canvas/SmartGuides.tsx";
import {TransformOriginHandle} from "../../../src/canvas/TransformOriginHandle.tsx";
import {AlignDistributePanel} from "../../../src/canvas/AlignDistributePanel.tsx";
import type {CanvasViewport,DocPoint,DocRect} from "../../../src/canvas/canvas-viewport.ts";
import type {CanvasGuide,RulerUnit} from "../../../src/canvas/ruler-model.ts";
import {DEFAULT_SNAP,snapRect,type GridSettings,type SnapHit,type SnapSettings} from "../../../src/canvas/snap-grid-model.ts";
import {computeSmartGuides,type SmartGuideResult} from "../../../src/canvas/smart-guides-model.ts";
import {contentToDoc,type BoundsCorners,type LayerTransform} from "../../../src/canvas/transform-origin-model.ts";
import type {AlignCommand,AlignReferenceKind,DistributeCommand,DistributeMode,MoveLayerCommand} from "../../../src/canvas/align-distribute-model.ts";

// A tiny stand-in for Prism: layers with content size and transform, guides,
// grid settings and one artboard. Every committed op is one undo step, like
// the engine; the log line records op names and payloads.
type Layer={id:string;name:string;w:number;h:number;t:LayerTransform;locked?:boolean};
type Doc={layers:Layer[];guides:CanvasGuide[];grid:GridSettings;snap:SnapSettings;origin:DocPoint};
type Host={scope:number;rulerDisabled:boolean;doc:Doc;past:Doc[];future:Doc[];selected:string[];unit:RulerUnit;reference:AlignReferenceKind;
  mode:DistributeMode;spacing:number|undefined;size:{width:number;height:number};
  drag:{id:string;rect:DocRect;smart:SmartGuideResult|undefined;grid:{x?:SnapHit;y?:SnapHit}|undefined}|undefined;
  guidePreview:string;log:string[];nextGuide:number};
const params=new URLSearchParams(location.search);
const ARTBOARD={id:"a1",name:"Poster",x:0,y:0,w:600,h:800};
const layer=(id:string,name:string,x:number,y:number,w:number,h:number,locked=false):Layer=>
  ({id,name,w,h,t:{tx:x,ty:y,sx:1,sy:1,rotation:0,ox:0,oy:0},...(locked?{locked}:{})});
// Bottom to top, like moveLayer's indices.
const layers=[layer("L4","Footer",60,620,480,100,params.get("lockfooter")!=="0"),layer("L2","Photo",60,220,220,220),
  layer("L3","Badge",340,240,120,120),layer("L1","Title",60,80,300,80)];
const useHost=create<Host>(()=>({scope:0,rulerDisabled:false,
  doc:{layers,guides:[{id:"g1",orientation:"horizontal",position:200},{id:"g2",orientation:"vertical",position:300}],
    grid:{spacing:40,subdivisions:4,visible:params.get("grid")!=="0"},snap:{...DEFAULT_SNAP},origin:{x:0,y:0}},
  past:[],future:[],selected:(params.get("select")??"L2").split(",").filter(Boolean),
  unit:(params.get("unit") as RulerUnit)??"px",reference:"selection",mode:"centers",spacing:undefined,
  size:{width:0,height:0},drag:undefined,guidePreview:"",log:[],nextGuide:3,
}));
const commit=(op:string,change:(d:Doc)=>Doc)=>useHost.setState(s=>({doc:change(s.doc),past:[...s.past,s.doc],future:[],log:[...s.log,op]}));
const undo=()=>useHost.setState(s=>s.past.length?{doc:s.past.at(-1)!,past:s.past.slice(0,-1),future:[s.doc,...s.future],log:[...s.log,"undo"]}:s);
const redo=()=>useHost.setState(s=>s.future.length?{doc:s.future[0]!,past:[...s.past,s.doc],future:s.future.slice(1),log:[...s.log,"redo"]}:s);
const mapLayers=(d:Doc,ids:readonly string[],f:(l:Layer)=>Layer)=>({...d,layers:d.layers.map(l=>ids.includes(l.id)?f(l):l)});
const cornersOf=(l:Layer):BoundsCorners=>[[0,0],[l.w,0],[l.w,l.h],[0,l.h]].map(([x,y])=>{
  const p=contentToDoc(l.t,{x:x!,y:y!});return [p.x,p.y] as const;}) as unknown as BoundsCorners;
const boundsOf=(l:Layer):DocRect=>{
  const c=cornersOf(l),xs=c.map(p=>p[0]),ys=c.map(p=>p[1]);
  return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
};
const union=(rs:DocRect[]):DocRect=>{
  const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));
  return {x,y,w:Math.max(...rs.map(r=>r.x+r.w))-x,h:Math.max(...rs.map(r=>r.y+r.h))-y};
};
const shift=(l:Layer,dx:number,dy:number):Layer=>({...l,t:{...l.t,tx:l.t.tx+dx,ty:l.t.ty+dy}});

function alignLayers(c:AlignCommand){
  commit(`alignLayers ${c.ids.join("+")} ${c.align} ${typeof c.to==="string"?c.to:"artboard:"+c.to.artboard}`,d=>{
    const sel=d.layers.filter(l=>c.ids.includes(l.id));
    const ref=c.to==="selection"?union(sel.map(boundsOf)):ARTBOARD;
    return mapLayers(d,c.ids,l=>{
      const b=boundsOf(l);
      switch(c.align){
        case "left":return shift(l,ref.x-b.x,0);
        case "hcenter":return shift(l,ref.x+ref.w/2-(b.x+b.w/2),0);
        case "right":return shift(l,ref.x+ref.w-(b.x+b.w),0);
        case "top":return shift(l,0,ref.y-b.y);
        case "vcenter":return shift(l,0,ref.y+ref.h/2-(b.y+b.h/2));
        case "bottom":return shift(l,0,ref.y+ref.h-(b.y+b.h));
      }
    });
  });
}
function distributeLayers(c:DistributeCommand){
  commit(`distributeLayers ${c.ids.join("+")} ${c.axis} ${c.mode}${c.spacing!==undefined?" "+c.spacing:""}`,d=>{
    const x=c.axis==="horizontal";
    const sel=d.layers.filter(l=>c.ids.includes(l.id)).map(l=>({l,b:boundsOf(l)}))
      .sort((a,b)=>x?a.b.x-b.b.x:a.b.y-b.b.y);
    const start=(b:DocRect)=>x?b.x:b.y,size=(b:DocRect)=>x?b.w:b.h;
    const first=sel[0]!.b,last=sel.at(-1)!.b;
    const moves=new Map<string,number>();
    if(c.mode==="centers"){
      const c0=start(first)+size(first)/2,c1=start(last)+size(last)/2;
      sel.forEach((s,i)=>moves.set(s.l.id,c0+(c1-c0)*i/(sel.length-1)-(start(s.b)+size(s.b)/2)));
    }else{
      const total=sel.reduce((n,s)=>n+size(s.b),0);
      const gap=c.spacing??(start(last)+size(last)-start(first)-total)/(sel.length-1);
      let at=start(first);
      for(const s of sel){moves.set(s.l.id,at-start(s.b));at+=size(s.b)+gap;}
    }
    return mapLayers(d,c.ids,l=>shift(l,x?moves.get(l.id)!:0,x?0:moves.get(l.id)!));
  });
}
function moveLayer(c:MoveLayerCommand){
  commit(`moveLayer ${c.id} ${c.to_index}`,d=>{
    const rest=d.layers.filter(l=>l.id!==c.id);
    rest.splice(c.to_index,0,d.layers.find(l=>l.id===c.id)!);
    return {...d,layers:rest};
  });
}
function setTransformOrigin(id:string,ox:number,oy:number){
  commit(`setTransformOrigin ${id} ${ox} ${oy}`,d=>mapLayers(d,[id],l=>{
    // Prism compensates tx/ty so the layer does not move: t' = A(o'−o) + o − o' + t.
    const before=contentToDoc(l.t,{x:ox,y:oy});
    return {...l,t:{...l.t,ox,oy,tx:before.x-ox,ty:before.y-oy}};
  }));
}

function viewportOf(size:{width:number;height:number}):CanvasViewport{
  const zoom=Number(params.get("zoom"))||Math.max(0.1,Math.min((size.width-64)/ARTBOARD.w,(size.height-64)/ARTBOARD.h));
  return {zoom,panX:Math.round((size.width-ARTBOARD.w*zoom)/2+12),panY:Math.round((size.height-ARTBOARD.h*zoom)/2+12),width:size.width,height:size.height};
}

function LayerBox({l,v,selected}:{l:Layer;v:CanvasViewport;selected:boolean}){
  const start=useRef<{x:number;y:number}>({x:0,y:0});
  const pan=useRef<ReturnType<typeof PanResponder.create>|null>(null);
  const latest=useRef({l,v});latest.current={l,v};
  if(!pan.current)pan.current=PanResponder.create({
    onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,
    onPanResponderGrant:()=>{
      const {l}=latest.current;
      useHost.setState(s=>({selected:s.selected.includes(l.id)?s.selected:[l.id]}));
      const b=boundsOf(l);start.current={x:b.x,y:b.y};
    },
    onPanResponderMove:(_e,g)=>{
      const {l,v}=latest.current;
      if(l.locked)return;
      const s=useHost.getState();
      const b=boundsOf(l);
      const moving={...b,x:start.current.x+g.dx/v.zoom,y:start.current.y+g.dy/v.zoom};
      const others=s.doc.layers.map(o=>({id:o.id,...boundsOf(o)}));
      const smart=computeSmartGuides({moving,others,movingIds:[l.id],zoom:v.zoom,enabled:s.doc.snap.enabled});
      const pulled=smart.dx!==0||smart.dy!==0||smart.alignments.length>0;
      const grid=pulled?undefined:snapRect(moving,{zoom:v.zoom,snap:s.doc.snap,grid:s.doc.grid,guides:s.doc.guides,artboards:[ARTBOARD]});
      useHost.setState({drag:{id:l.id,rect:grid?grid.rect:smart.rect,smart:pulled?smart:undefined,grid:grid?{...(grid.x?{x:grid.x}:{}),...(grid.y?{y:grid.y}:{})}:undefined}});
    },
    onPanResponderRelease:()=>{
      const {l}=latest.current;
      const d=useHost.getState().drag;
      useHost.setState({drag:undefined});
      if(!d)return;
      const b=boundsOf(l);
      const dx=Math.round((d.rect.x-b.x)*100)/100,dy=Math.round((d.rect.y-b.y)*100)/100;
      if(dx||dy)commit(`translateLayers ${l.id} ${dx} ${dy}`,doc=>mapLayers(doc,[l.id],x=>shift(x,dx,dy)));
    },
    onPanResponderTerminate:()=>useHost.setState({drag:undefined}),
  });
  const drag=useHost(s=>s.drag);
  const b=drag?.id===l.id?drag.rect:boundsOf(l);
  return <View {...pan.current.panHandlers} accessibilityLabel={l.name+(l.locked?", locked":"")}
    {...{className:"bg-surface-raised border "+(selected?"border-primary":"border-border")}}
    style={{position:"absolute",left:v.panX+b.x*v.zoom,top:v.panY+b.y*v.zoom,width:b.w*v.zoom,height:b.h*v.zoom,
      borderWidth:selected?2:1,padding:4,cursor:"grab" as never}}>
    <Text {...{className:"text-text-muted text-xs"}} numberOfLines={1}>{l.name}{l.locked?" (locked)":""}</Text>
  </View>;
}

function Canvas(){
  const s=useHost();
  const v=viewportOf(s.size);
  const sel=s.doc.layers.filter(l=>s.selected.includes(l.id));
  const one=sel.length===1?sel[0]:undefined;
  return <View testID="canvas" {...{className:"bg-surface-sunken"}}
    onLayout={e=>useHost.setState({size:{width:Math.round(e.nativeEvent.layout.width),height:Math.round(e.nativeEvent.layout.height)}})}
    style={{flex:1,minHeight:460,overflow:"hidden",position:"relative"}}>
    {s.size.width>0?<>
      <Pressable accessibilityLabel="Deselect" onPress={()=>useHost.setState({selected:[]})}
        style={{position:"absolute",left:0,top:0,right:0,bottom:0}}/>
      <View pointerEvents="none" {...{className:"bg-surface-raised border border-border"}}
        style={{position:"absolute",left:v.panX,top:v.panY,width:ARTBOARD.w*v.zoom,height:ARTBOARD.h*v.zoom}}/>
      <SnapGridOverlay viewport={v} grid={s.doc.grid} snapped={s.drag?.grid}/>
      {s.doc.layers.map(l=><LayerBox key={l.id} l={l} v={v} selected={s.selected.includes(l.id)}/>)}
      <SmartGuides viewport={v} result={s.drag?.smart} names={Object.fromEntries(s.doc.layers.map(l=>[l.id,l.name]))}/>
      {sel.length&&!s.drag?<TransformOriginHandle scope={String(s.scope)} disabled={s.rulerDisabled} viewport={v}
        corners={one?cornersOf(one):(()=>{const u=union(sel.map(boundsOf));return [[u.x,u.y],[u.x+u.w,u.y],[u.x+u.w,u.y+u.h],[u.x,u.y+u.h]] as const;})()}
        {...(one&&!one.locked?{transform:one.t}:{unavailableReason:one?`Unlock ${one.name} to move its pivot`:"Select one layer to move its pivot"})}
        onSetOrigin={(ox,oy)=>one&&setTransformOrigin(one.id,ox,oy)}/>:null}
      <CanvasRuler scope={String(s.scope)} disabled={s.rulerDisabled} viewport={v} unit={s.unit} dpi={150} origin={s.doc.origin} guides={s.doc.guides}
        onAddGuide={g=>{const id="g"+useHost.getState().nextGuide;useHost.setState(x=>({nextGuide:x.nextGuide+1}));
          commit(`addGuide ${g.orientation} ${g.position}`,d=>({...d,guides:[...d.guides,{id,...g}]}));}}
        onMoveGuide={(id,position)=>commit(`moveGuide ${id} ${position}`,d=>({...d,guides:d.guides.map(g=>g.id===id?{...g,position}:g)}))}
        onRemoveGuide={id=>commit(`removeGuide ${id}`,d=>({...d,guides:d.guides.filter(g=>g.id!==id)}))}
        onGuidePreview={p=>useHost.setState({guidePreview:p?`${p.id??"new"} ${p.orientation} ${p.position}${p.removing?" removing":""}`:""})}
        onOriginChange={o=>commit(`setOrigin ${o.x} ${o.y}`,d=>({...d,origin:o}))}/>
    </>:null}
  </View>;
}

function Panels(){
  const s=useHost();
  const sel=s.doc.layers.filter(l=>s.selected.includes(l.id));
  const idx=sel.length===1?s.doc.layers.findIndex(l=>l.id===sel[0]!.id):-1;
  return <View style={{gap:24,padding:16}}>
    <View style={{flexDirection:"row",gap:8,flexWrap:"wrap"}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Replace ruler document" onPress={()=>useHost.setState(v=>({scope:v.scope+1,guidePreview:""}))}><Text>Replace ruler document</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Disable ruler" onPress={()=>useHost.setState({rulerDisabled:true,guidePreview:""})}><Text>Disable ruler</Text></Pressable>
      <Pressable role="button" aria-label="Undo" onPress={undo} {...{className:"rounded-control border border-border bg-surface-raised"}}
        style={{minHeight:44,paddingHorizontal:12,justifyContent:"center"}}><Text {...{className:"text-text"}}>Undo</Text></Pressable>
      <Pressable role="button" aria-label="Redo" onPress={redo} {...{className:"rounded-control border border-border bg-surface-raised"}}
        style={{minHeight:44,paddingHorizontal:12,justifyContent:"center"}}><Text {...{className:"text-text"}}>Redo</Text></Pressable>
      <Pressable role="button" aria-label="Select all" onPress={()=>useHost.setState(x=>({selected:x.doc.layers.map(l=>l.id)}))}
        {...{className:"rounded-control border border-border bg-surface-raised"}}
        style={{minHeight:44,paddingHorizontal:12,justifyContent:"center"}}><Text {...{className:"text-text"}}>Select all</Text></Pressable>
    </View>
    <AlignDistributePanel items={sel.map(l=>({id:l.id,name:l.name,...(l.locked?{locked:true}:{})}))}
      reference={s.reference} onReferenceChange={reference=>useHost.setState({reference})}
      artboard={{id:ARTBOARD.id,name:ARTBOARD.name}} onAlign={alignLayers}
      distributeMode={s.mode} onDistributeModeChange={mode=>useHost.setState({mode})}
      spacing={s.spacing} onSpacingChange={spacing=>useHost.setState({spacing})} onDistribute={distributeLayers}
      {...(idx>=0?{stack:{index:idx,count:s.doc.layers.length}}:{})} onMoveLayer={moveLayer}/>
    <SnapGridSettings scope={String(s.scope)} disabled={s.rulerDisabled} grid={s.doc.grid} snap={s.doc.snap}
      onGridChange={grid=>commit(`grid ${grid.visible?"on":"off"} ${grid.spacing}/${grid.subdivisions}`,d=>({...d,grid}))}
      onSnapChange={snap=>commit(`snap ${snap.enabled?"on":"off"} ${[snap.toGrid&&"grid",snap.toGuides&&"guides",snap.toArtboards&&"artboards"].filter(Boolean).join("+")} ${snap.thresholdPx} ${snap.strength}`,d=>({...d,snap}))}/>
  </View>;
}

function State(){
  const s=useHost();
  const describe=s.doc.layers.map(l=>{const b=boundsOf(l);return `${l.id}@${Math.round(b.x)},${Math.round(b.y)}`;}).join(" ");
  return <View style={{paddingHorizontal:16,gap:2}}>
    <Text testID="log" {...{className:"text-text-muted text-xs"}}>{"log "+s.log.join(" | ")}</Text>
    <Text testID="doc" {...{className:"text-text-muted text-xs"}}>{"layers "+describe}</Text>
    <Text testID="guides" {...{className:"text-text-muted text-xs"}}>{"guides "+s.doc.guides.map(g=>`${g.id}:${g.orientation[0]}${g.position}`).join(" ")}</Text>
    <Text testID="preview" {...{className:"text-text-muted text-xs"}}>{"preview "+s.guidePreview}</Text>
  </View>;
}

function Fixture(){
  const wide=typeof innerWidth==="number"&&innerWidth>=700;
  return wide
    ?<View style={{flexDirection:"row",height:innerHeight,width:"100%"}}>
      <View style={{flex:1,minHeight:0}}><Canvas/></View>
      <ScrollView {...{className:"bg-surface-raised border-l border-border"}} style={{width:340,flexGrow:0}}><Panels/><State/></ScrollView>
    </View>
    :<ScrollView style={{flex:1}}>
      <View style={{height:460}}><Canvas/></View>
      <View {...{className:"bg-surface-raised"}}><Panels/><State/></View>
    </ScrollView>;
}

document.documentElement.dataset.theme=params.get("theme")??"light";
document.documentElement.dir=params.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><Fixture/></View>;}
AppRegistry.registerComponent("CanvasGuides",()=>Root);
AppRegistry.runApplication("CanvasGuides",{rootTag:document.getElementById("root")});
