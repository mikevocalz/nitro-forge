import {AppRegistry,ScrollView,Text,View} from "react-native";
import {create} from "zustand";
import {hsvToRgb,rgbToHsv,rgbaToHex,type HsvColor} from "../../../src/color.ts";
import {AlphaSlider} from "../../../src/color/AlphaSlider.tsx";
import {ColorWheel} from "../../../src/color/ColorWheel.tsx";
import {ColorDiscPicker} from "../../../src/color/ColorDiscPicker.tsx";
import {ColorChannelFields} from "../../../src/color/ColorChannelFields.tsx";
import {ForegroundBackgroundChips} from "../../../src/color/ForegroundBackgroundChips.tsx";
import {SwatchGrid} from "../../../src/color/SwatchGrid.tsx";
import {ColorHarmonyAssistant} from "../../../src/color/ColorHarmonyAssistant.tsx";
import {FloatingColorPalette} from "../../../src/color/FloatingColorPalette.tsx";
import type {ChannelModel} from "../../../src/color/channel-fields.ts";
import type {ColorPair,ColorPairSlot} from "../../../src/color/color-pair.ts";
import type {HarmonyKind} from "../../../src/color/harmony.ts";
import type {PaletteMode,PalettePosition} from "../../../src/color/floating-palette.ts";
import {pushRecentSwatch,swatchKey,type Swatch,type SwatchGroup} from "../../../src/color/swatches.ts";

const params=new URLSearchParams(location.search);
const rtl=params.get("dir")==="rtl";
type Host={
  color:HsvColor;preview:HsvColor|undefined;commits:number;
  pair:ColorPair;slot:ColorPairSlot;model:ChannelModel;kind:HarmonyKind;
  recent:Swatch[];query:string;
  docked:boolean;position:PalettePosition;mode:PaletteMode;bounds:{width:number;height:number};
};
const start:HsvColor={h:217,s:0.72,v:0.82,alpha:0.85};
// The one color store: every picker reads and commits this, as a Forge adapter would.
const useHost=create<Host>(()=>({
  color:start,preview:undefined,commits:0,
  pair:{foreground:hsvToRgb(start),background:{r:250,g:248,b:240,alpha:1}},slot:"foreground",
  model:"hsl",kind:"split-complementary",recent:[],query:"",
  docked:params.get("float")!=="1",position:{x:24,y:24},mode:(params.get("mode") as PaletteMode)??"compact",
  bounds:{width:0,height:0},
}));
const commit=(next:HsvColor)=>useHost.setState(s=>{
  const rgb=hsvToRgb(next);
  return {color:next,preview:undefined,commits:s.commits+1,
    pair:{...s.pair,[s.slot]:rgb},recent:pushRecentSwatch(s.recent,rgb,8)};
});
const preview=(next:HsvColor)=>useHost.setState({preview:next});
const named:Swatch[]=[
  ["Harbor",{r:31,g:95,b:209,alpha:1}],["Moss",{r:74,g:112,b:52,alpha:1}],["Brick",{r:166,g:58,b:40,alpha:1}],
  ["Saffron",{r:240,g:170,b:30,alpha:1}],["Slate",{r:84,g:96,b:110,alpha:1}],["Plum",{r:110,g:48,b:110,alpha:1}],
  ["Sea glass",{r:120,g:200,b:180,alpha:1}],["Ink",{r:20,g:24,b:30,alpha:1}],["Bone",{r:236,g:230,b:214,alpha:1}],
].map(([name,color],i)=>({id:"n"+i,name:name as string,color:color as Swatch["color"]}));

function PaletteBody({mode}:{mode:PaletteMode}){
  const color=useHost(s=>s.preview??s.color);
  const committed=useHost(s=>s.color);
  const query=useHost(s=>s.query);
  const recent=useHost(s=>s.recent);
  const groups:SwatchGroup[]=[
    {id:"recent",label:"Recent",kind:"recent",swatches:recent},
    {id:"document",label:"This document",kind:"document",swatches:[]},
    {id:"named",label:"Named",kind:"named",swatches:named},
  ];
  return mode==="compact"?<ColorDiscPicker value={committed} onPreview={preview} onCommit={commit} maxSize={232} rtl={rtl} testID="disc" renderDisc={params.has("renderer")?({size,value})=><View testID="managed-disc" style={{width:size,height:size,backgroundColor:"red"}}><Text>{`Managed brightness ${value.v}`}</Text></View>:undefined}/>
    :mode==="classic"?<View style={{gap:12}}>
      <ColorWheel value={committed} onPreview={preview} onCommit={commit} maxSize={220} testID="wheel"/>
      <AlphaSlider value={hsvToRgb(committed)} onPreview={c=>preview({...committed,alpha:c.alpha})}
        onCommit={c=>commit({...committed,alpha:c.alpha})} rtl={rtl} testID="alpha"/>
    </View>
    :<SwatchGrid rtl={rtl} groups={groups} query={query} onQueryChange={q=>useHost.setState({query:q})}
      selectedKey={rgbaToHex(hsvToRgb(color))} onSelect={s=>commit(rgbToHsv(s.color,committed.h))}/>;
}

function Fixture(){
  const s=useHost();
  const shown=s.preview??s.color;
  const rgb=hsvToRgb(shown);
  const hinge=params.get("hinge")==="1"&&s.bounds.width>0
    ?[{x:s.bounds.width/2-10,y:0,width:20,height:s.bounds.height}]:[];
  return <ScrollView contentContainerStyle={{padding:16,gap:16,maxWidth:900,width:"100%",alignSelf:"center"}}>
    <View onLayout={e=>useHost.setState({bounds:{width:e.nativeEvent.layout.width,height:e.nativeEvent.layout.height}})}
      style={{flexDirection:"row",flexWrap:"wrap",gap:16,alignItems:"flex-start",minHeight:640}}>
      {hinge.map((h,i)=><View key={i} testID="hinge" {...{className:"bg-border"}} style={{position:"absolute",left:h.x,top:0,width:h.width,height:h.height,opacity:0.6}}/>)}
      {s.bounds.width>0&&s.bounds.height>0?<FloatingColorPalette testID="palette" docked={s.docked} position={s.position} mode={s.mode}
        bounds={{x:0,y:0,width:s.bounds.width,height:s.bounds.height}} obstacles={hinge}
        onModeChange={mode=>useHost.setState({mode})}
        onUndock={position=>useHost.setState({docked:false,position})}
        onMove={position=>useHost.setState({position})}
        onDock={()=>useHost.setState({docked:true})}
        onClose={()=>useHost.setState({docked:true})}
        style={s.docked?{flexBasis:300,flexGrow:1,maxWidth:420}:undefined}>
        {mode=><PaletteBody mode={mode}/>}
      </FloatingColorPalette>:null}
      <View style={{flexBasis:300,flexGrow:1,gap:16,maxWidth:460}}>
        <View {...{className:"rounded-card border border-border bg-surface-raised"}} style={{padding:12,gap:12}}>
          <ForegroundBackgroundChips testID="chips" value={s.pair} active={s.slot}
            onActiveChange={slot=>useHost.setState(h=>({slot,color:rgbToHsv(h.pair[slot],h.color.h)}))}
            onCommit={pair=>useHost.setState(h=>({pair,color:rgbToHsv(pair[h.slot],h.color.h),commits:h.commits+1}))}/>
        </View>
        <ColorChannelFields testID="fields" value={s.color} model={s.model} onModelChange={model=>useHost.setState({model})} onCommit={commit}/>
        <ColorHarmonyAssistant testID="harmony" value={s.color} kind={s.kind} onKindChange={kind=>useHost.setState({kind})}
          onPick={commit} contrastBackground={s.pair.background}/>
      </View>
    </View>
    <View style={{gap:4}}>
      <Text testID="hex" {...{className:"text-text-muted"}}>{"hex "+rgbaToHex(rgb)}</Text>
      <Text testID="hsv" {...{className:"text-text-muted"}}>{`hsv ${Math.round(shown.h)} ${Math.round(shown.s*100)} ${Math.round(shown.v*100)} ${Math.round(shown.alpha*100)}`}</Text>
      <Text testID="commits" {...{className:"text-text-muted"}}>{"commits "+s.commits}</Text>
      <Text testID="docked" {...{className:"text-text-muted"}}>{(s.docked?"docked":"floating")+` ${Math.round(s.position.x)},${Math.round(s.position.y)}`}</Text>
      <Text testID="recent" {...{className:"text-text-muted"}}>{"recent "+s.recent.map(swatchKey).join(" ")}</Text>
    </View>
  </ScrollView>;
}
document.documentElement.dataset.theme=params.get("theme")??"light";
if(params.get("dir")==="rtl")document.documentElement.dir="rtl";
AppRegistry.registerComponent("ColorAcceptance",()=>Fixture);
AppRegistry.runApplication("ColorAcceptance",{rootTag:document.getElementById("root")});
