import {AppRegistry,Pressable,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {Button} from "@nyc-tron/ui/components/Button";
import {PenNodeEditor} from "../../../src/vector/PenNodeEditor.tsx";
import {ShapeBuilder} from "../../../src/vector/ShapeBuilder.tsx";
import {FillStrokeInspector,type PaintSwatch} from "../../../src/vector/FillStrokeInspector.tsx";
import {GradientOnCanvasHandles} from "../../../src/vector/GradientOnCanvasHandles.tsx";
import type {BooleanGroup,BuilderLayer} from "../../../src/vector/shape-builder-model.ts";
import type {PaintableKind} from "../../../src/vector/fill-stroke-model.ts";
import {
  rgbaToCss,
  type BooleanOp,type FillRule,type GradientPaint,type NodeRef,type Paint,type PaintOrder,type Stroke,type Subpath,
  type ViewTransform,
} from "../../../src/vector/vector-types.ts";

const params=new URLSearchParams(location.search);
const part=params.get("part")??"all";
const kind=(params.get("kind")??"path") as PaintableKind;

// Host palette for the fixture; NYC-Tron ships no colors.
const SWATCHES:PaintSwatch[]=[
  {id:"ink",label:"Ink",color:[29,29,29,255]},{id:"teal",label:"Teal",color:[31,122,109,255]},
  {id:"blue",label:"Blue",color:[66,99,235,255]},{id:"amber",label:"Amber",color:[241,172,75,255]},
  {id:"red",label:"Red",color:[224,49,49,255]},{id:"paper",label:"Paper",color:[255,255,255,255]},
];
const LINEAR:GradientPaint={type:"linear",x0:60,y0:150,x1:340,y1:150,stops:[
  {offset:0,color:[66,99,235,255]},{offset:0.5,color:[31,122,109,255]},{offset:1,color:[241,172,75,255]}]};
const RADIAL:GradientPaint={type:"radial",cx:200,cy:140,r:110,fx:240,fy:120,stops:LINEAR.stops};

/*
 * Test stand-in for the Forge adapter over Prism: one path layer (id 7) and a
 * small layer list for booleans. Each callback is applied as the engine op it
 * maps to, recorded in the op log, and pushed on an undo stack, the way every
 * Prism op is one undo step.
 */
type Doc={
  subpaths:Subpath[];fill:Paint|null;stroke:Stroke|null;fillRule:FillRule;paintOrder:PaintOrder;
  layers:BuilderLayer[];group:BooleanGroup|undefined;
};
type Host={doc:Doc;past:Doc[];log:string[];selection:NodeRef|undefined;stop:number|undefined;
  picked:number[];preview:string;stroke:Stroke|undefined};
const initialDoc:Doc={
  subpaths:[{closed:true,nodes:[
    {x:60,y:220,kind:"corner"},
    {x:150,y:70,in:[-40,40],out:[40,-40],kind:"smooth"},
    {x:300,y:80,in:[-50,0],out:[50,0],kind:"symmetric"},
    {x:340,y:230,kind:"corner"},
  ]}],
  fill:params.get("fill")==="radial"?RADIAL:params.get("fill")==="solid"?{type:"solid",color:[31,122,109,255]}:LINEAR,
  stroke:{paint:{type:"solid",color:[29,29,29,255]},width:2,join:"miter",cap:"butt",miter_limit:4,dash:[],dash_offset:0},
  fillRule:"nonzero",paintOrder:"fill-stroke",
  layers:[
    {id:11,name:"Rectangle",kind:"shape",parent:null,locked:false},
    {id:12,name:"Circle",kind:"path",parent:null,locked:false},
    {id:13,name:"Photo",kind:"raster",parent:null,locked:false},
    {id:14,name:"Star",kind:"path",parent:null,locked:true},
  ],
  group:undefined,
};
const useHost=create<Host>(()=>({doc:initialDoc,past:[],log:[],selection:params.get("select")?{subpath:0,index:Number(params.get("select"))}:undefined,
  stop:undefined,picked:params.get("picked")?.split(",").map(Number)??[],preview:"",stroke:undefined}));
function apply(op:string,mutate:(doc:Doc)=>Doc){
  useHost.setState(s=>({doc:mutate(s.doc),past:[...s.past,s.doc],log:[...s.log,op]}));
}
function undo(){
  useHost.setState(s=>s.past.length?{doc:s.past[s.past.length-1]!,past:s.past.slice(0,-1),log:[...s.log,"undo"]}:s);
}

const canvasWidth=Math.min((typeof innerWidth==="number"?innerWidth:390)-32,560);
const scale=canvasWidth/400;
const canvasHeight=Math.round(300*scale);
const transform:ViewTransform=[scale,0,0,scale,0,0];

function cssGradient(p:Paint|null):object{
  if(!p)return {};
  if(p.type==="solid")return {backgroundColor:rgbaToCss(p.color)};
  const stops=p.stops.map(s=>`${rgbaToCss(s.color)} ${Math.round(s.offset*100)}%`).join(", ");
  if(p.type==="linear"){
    const deg=Math.atan2(p.y1-p.y0,p.x1-p.x0)*180/Math.PI+90;
    return {backgroundImage:`linear-gradient(${deg}deg, ${stops})`};
  }
  return {backgroundImage:`radial-gradient(circle at ${(p.fx??p.cx)/4}% ${(p.fy??p.cy)/3}%, ${stops})`};
}
/** Stand-in canvas: the layer's fill over the document area. Prism draws the real thing. */
function Canvas({paint}:{paint:Paint|null}){
  return <View {...{className:"bg-surface-sunken"}} style={{position:"absolute",left:0,top:0,right:0,bottom:0}}>
    <View style={{position:"absolute",left:60*scale,top:70*scale,width:280*scale,height:160*scale,opacity:0.55,
      borderRadius:8,...cssGradient(paint)}}/>
  </View>;
}

function PenPart(){
  const s=useHost();
  return <View style={{gap:8}}>
    <Text accessibilityRole="header" {...{className:"text-text font-semibold"}}>Path nodes</Text>
    <PenNodeEditor subpaths={s.doc.subpaths} width={canvasWidth} height={canvasHeight} transform={transform}
      selection={s.selection} onSelectionChange={selection=>useHost.setState({selection})}
      onPreview={p=>useHost.setState({preview:p?"previewing":""})}
      onSetPathNode={({subpath,index,node})=>apply(`setPathNode ${subpath}:${index}`,d=>({...d,
        subpaths:d.subpaths.map((sp,si)=>si!==subpath?sp:{...sp,nodes:sp.nodes.map((n,i)=>i===index?node:n)})}))}
      onInsertNode={intent=>apply(intent.neighborsChanged?"setPathNodes":`insertPathNode ${intent.subpath}:${intent.index}`,
        d=>({...d,subpaths:intent.subpaths}))}
      onRemoveNode={({subpath,index})=>apply(`removePathNode ${subpath}:${index}`,d=>({...d,
        subpaths:d.subpaths.map((sp,si)=>si!==subpath?sp:{...sp,nodes:sp.nodes.filter((_,i)=>i!==index)})}))}
      onSetNodeKind={intent=>apply(intent.handlesChanged?`setPathNode ${intent.subpath}:${intent.index}`:`setNodeKind ${intent.kind}`,
        d=>({...d,subpaths:d.subpaths.map((sp,si)=>si!==intent.subpath?sp:{...sp,nodes:sp.nodes.map((n,i)=>i===intent.index?intent.node:n)})}))}
      onSetClosed={({subpath,closed})=>apply(`setSubpathClosed ${closed}`,d=>({...d,
        subpaths:d.subpaths.map((sp,si)=>si===subpath?{...sp,closed}:sp)}))}>
      <Canvas paint={s.doc.fill}/>
    </PenNodeEditor>
  </View>;
}

function BuilderPart(){
  const s=useHost();
  const selection=s.doc.layers.filter(l=>s.picked.includes(l.id));
  const top=s.doc.layers.filter(l=>l.parent===null);
  return <View style={{gap:8}}>
    <Text accessibilityRole="header" {...{className:"text-text font-semibold"}}>Layers</Text>
    <View role="group" aria-label="Select layers" style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
      {top.map(l=>{
        const on=s.picked.includes(l.id);
        return <Pressable key={l.id} role="checkbox" aria-checked={on} aria-label={"Select "+l.name}
          onPress={()=>useHost.setState(h=>({picked:on?h.picked.filter(x=>x!==l.id):[...h.picked,l.id]}))}
          {...{className:"rounded-control border px-3 justify-center focus-visible:ring-2 focus-visible:ring-focus "+(on?"border-primary bg-primary/10":"border-border bg-surface-raised")}}
          style={{minHeight:44}}>
          <Text {...{className:"text-text"}}>{l.name}{l.locked?" (locked)":""}</Text>
        </Pressable>;
      })}
    </View>
    <ShapeBuilder selection={selection} group={s.doc.group}
      onBoolean={({ids,op})=>{
        apply(`booleanLayers ${ids.join(",")} ${op}`,d=>{
          const operands=[...d.layers.filter(l=>ids.includes(l.id))].reverse().map(l=>({...l,parent:20,parentKind:"boolean" as const}));
          return {...d,layers:[...d.layers.filter(l=>!ids.includes(l.id)),...operands,{id:20,name:"Badge",kind:"boolean",parent:null,locked:false}],
            group:{id:20,name:"Badge",op,locked:false,operands}};
        });
        useHost.setState({picked:[20]});
      }}
      onSetBooleanOp={({id,op})=>apply(`setBooleanOp ${id} ${op}`,d=>({...d,group:d.group&&{...d.group,op:op as BooleanOp}}))}
      onRelease={({id})=>{
        apply(`ungroupLayer ${id}`,d=>({...d,group:undefined,
          layers:d.layers.filter(l=>l.id!==id).map(l=>l.parent===id?{...l,parent:null,parentKind:undefined}:l) as BuilderLayer[]}));
        useHost.setState({picked:[]});
      }}
      onExpand={({id})=>{
        apply(`rasterizeLayer ${id}`,d=>({...d,group:undefined,
          layers:d.layers.filter(l=>l.parent!==id).map(l=>l.id===id?{...l,kind:"raster" as const,name:"Badge pixels"}:l)}));
        useHost.setState({picked:[]});
      }}
      onSelectOperand={id=>useHost.setState(h=>({log:[...h.log,"selectLayers "+id]}))}/>
  </View>;
}

function InspectorPart(){
  const s=useHost();
  return <View style={{gap:8}}>
    <Text accessibilityRole="header" {...{className:"text-text font-semibold"}}>Appearance</Text>
    <FillStrokeInspector kind={kind} fill={kind==="shape"&&s.doc.fill?.type!=="solid"?{type:"solid",color:[31,122,109,255]}:s.doc.fill}
      stroke={kind==="path"?s.doc.stroke:null} fillRule={s.doc.fillRule} paintOrder={s.doc.paintOrder}
      bounds={{x:60,y:70,width:280,height:160}} swatches={SWATCHES} selectedStop={s.stop}
      onSetFill={fill=>apply("setFill "+(fill?.type??"none"),d=>({...d,fill}))}
      onSetStroke={stroke=>apply("setStroke "+(stroke?`${stroke.width} ${stroke.join} ${stroke.cap} [${stroke.dash.join(",")}]`:"none"),d=>({...d,stroke}))}
      onPreviewStroke={stroke=>useHost.setState({stroke})}
      onSetFillRule={rule=>apply("setFillRule "+rule,d=>({...d,fillRule:rule}))}
      onSetPaintOrder={order=>apply("setPaintOrder "+order,d=>({...d,paintOrder:order}))}
      onRequestColor={target=>useHost.setState(h=>({log:[...h.log,"pick color "+target]}))}/>
  </View>;
}

function GradientPart(){
  const s=useHost();
  const fill=s.doc.fill;
  if(!fill||fill.type==="solid")return <Text {...{className:"text-text-muted"}}>Pick a linear or radial fill to edit it on the canvas.</Text>;
  return <View style={{gap:8}}>
    <Text accessibilityRole="header" {...{className:"text-text font-semibold"}}>Gradient</Text>
    <GradientOnCanvasHandles paint={fill} width={canvasWidth} height={canvasHeight} transform={transform}
      selectedStop={s.stop} onSelectStop={stop=>useHost.setState({stop})}
      onPreview={p=>useHost.setState({preview:p?"previewing":""})}
      onSetFill={paint=>apply("setFill "+paint.type,d=>({...d,fill:paint}))}>
      <Canvas paint={fill}/>
    </GradientOnCanvasHandles>
  </View>;
}

function VectorFixture(){
  const log=useHost(s=>s.log);
  const preview=useHost(s=>s.preview);
  const doc=useHost(s=>s.doc);
  const canUndo=useHost(s=>s.past.length>0);
  return <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,gap:20}}>
    <View style={{flexDirection:"row",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <Button title="Undo" variant="secondary" disabled={!canUndo} onPress={undo}/>
      <Text testID="vector-preview" {...{className:"text-text-muted text-xs"}}>{preview}</Text>
    </View>
    {part==="all"||part==="pen"?<PenPart/>:null}
    {part==="all"||part==="gradient"?<GradientPart/>:null}
    {part==="all"||part==="inspector"?<InspectorPart/>:null}
    {part==="all"||part==="builder"?<BuilderPart/>:null}
    <Text testID="vector-log" {...{className:"text-text-muted text-xs"}}>{"log "+log.join(" | ")}</Text>
    <Text testID="vector-doc" {...{className:"text-text-muted text-xs"}} style={{opacity:0.6}}>
      {JSON.stringify({subpaths:doc.subpaths,fill:doc.fill,stroke:doc.stroke})}</Text>
  </ScrollView>;
}

document.documentElement.dataset.theme=params.get("theme")??"light";
document.documentElement.dir=params.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir,className:"bg-surface-raised"}} style={{flex:1}}><VectorFixture/></View>;}
AppRegistry.registerComponent("VectorAcceptance",()=>Root);
AppRegistry.runApplication("VectorAcceptance",{rootTag:document.getElementById("root")});
