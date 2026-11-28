import {AppRegistry,Text,View} from "react-native";
import {create} from "zustand";
import {InkToolbar} from "../../../src/ink/InkToolbar.tsx";
import {INK_BOARD_TOOLS,type InkSize,type InkTool} from "../../../src/ink/ink-model.ts";

// The host palette: QuickDraw light-theme stroke colors from Forge's board
// scene compiler. NYC-Tron ships no palette; this fixture plays the host.
const SWATCHES=[
  {id:"black",label:"Black",value:"#1D1D1D"},{id:"blue",label:"Blue",value:"#4263EB"},
  {id:"green",label:"Green",value:"#099268"},{id:"yellow",label:"Yellow",value:"#F1AC4B"},
  {id:"red",label:"Red",value:"#E03131"},{id:"violet",label:"Violet",value:"#AE3EC9"},
];
type Ink={tool:InkTool;size:InkSize;color:string;opacity:number;pressure:boolean;past:number;future:number;log:string[]};
const useInk=create<Ink>(()=>({tool:"pen",size:"m",color:"blue",opacity:1,pressure:true,past:2,future:0,log:[]}));
const note=(entry:string)=>useInk.setState(s=>({log:[...s.log,entry]}));

function Toolbar({vertical}:{vertical:boolean}){
  const s=useInk();
  return <InkToolbar orientation={vertical?"vertical":"horizontal"} edge={vertical?"right":"top"}
    tools={INK_BOARD_TOOLS.map(tool=>({tool}))} tool={s.tool}
    onToolChange={tool=>{useInk.setState({tool});note("tool "+tool);}}
    size={s.size} onSizeChange={size=>{useInk.setState({size});note("size "+size);}}
    swatches={SWATCHES} color={s.color} onColorChange={color=>{useInk.setState({color});note("color "+color);}}
    onRequestCustomColor={()=>note("custom color")}
    opacity={s.opacity} onOpacityChange={opacity=>{useInk.setState({opacity});note("opacity "+opacity);}}
    undo={s.past>0?{enabled:true}:{enabled:false,reason:"Nothing to undo"}}
    redo={s.future>0?{enabled:true}:{enabled:false,reason:"Nothing to redo"}}
    onUndo={()=>{useInk.setState(x=>({past:x.past-1,future:x.future+1}));note("undo");}}
    onRedo={()=>{useInk.setState(x=>({past:x.past+1,future:x.future-1}));note("redo");}}
    pressure={{enabled:s.pressure}} onPressureChange={pressure=>{useInk.setState({pressure});note("pressure "+pressure);}}/>;
}

function InkFixture(){
  const log=useInk(s=>s.log);
  const wide=typeof innerWidth==="number"&&innerWidth>=700;
  return <View style={{flex:1,flexDirection:wide?"row":"column",minHeight:"100vh" as never}}>
    {wide?null:<Toolbar vertical={false}/>}
    <View {...{className:"bg-surface-sunken"}} style={{flex:1,padding:16,gap:8}}>
      <Text {...{className:"text-text-muted"}}>Board canvas (drawn by Forge)</Text>
      <Text testID="ink-log" {...{className:"text-text-muted"}}>{"log "+log.join(", ")}</Text>
    </View>
    {wide?<Toolbar vertical/>:null}
  </View>;
}

const params=new URLSearchParams(location.search);
document.documentElement.dataset.theme=params.get("theme")??"light";
document.documentElement.dir=params.get("dir")==="rtl"?"rtl":"ltr";
// React Native Web resolves row direction and start/end styles from a `dir`
// on an ancestor View, the way an RTL app sets it.
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><InkFixture/></View>;}
AppRegistry.registerComponent("InkAcceptance",()=>Root);
AppRegistry.runApplication("InkAcceptance",{rootTag:document.getElementById("root")});
