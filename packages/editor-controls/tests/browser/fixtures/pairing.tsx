import {AppRegistry,Text,View} from "react-native";
import {create} from "zustand";
import {DevicePairingDialog} from "../../../src/devices/DevicePairingDialog.tsx";
import type {PairingState} from "../../../src/devices/pairing-model.ts";

// Plays the Forge pen host: `?state=` picks the PairingState, and every
// callback is logged so the spec can check which one a button reached.
const pen={id:"pen-1",name:"Forge Stylus",detail:"Model S",signalDbm:-58};
const STATES:Record<string,PairingState>={
  idle:{kind:"idle"},
  scanning:{kind:"scanning",devices:[pen]},
  "system-pairing":{kind:"system-pairing",steps:[
    "Open Settings, then Bluetooth.",
    "Hold the pen's top button until its light blinks.",
    "Select Forge Stylus and tap Pair.",
  ]},
  connecting:{kind:"connecting",device:pen},
  "awaiting-input":{kind:"awaiting-input",device:pen},
  connected:{kind:"connected",device:pen},
};
const params=new URLSearchParams(location.search);
const useLog=create<{log:string[]}>(()=>({log:[]}));
const note=(entry:string)=>()=>useLog.setState(s=>({log:[...s.log,entry]}));

function PairingFixture(){
  const log=useLog(s=>s.log);
  const state=STATES[params.get("state")??"idle"]??STATES.idle;
  return <View {...{className:"bg-surface-sunken"}} style={{flex:1,padding:16,gap:8,minHeight:"100vh" as never}}>
    <Text testID="pairing-log" {...{className:"text-text-muted"}}>{"log "+log.join(", ")}</Text>
    <DevicePairingDialog visible state={state} deviceNoun="pen" title="Connect your pen" testID="pair"
      intro="Search asks for Bluetooth access so the app can find your pen. Nothing else on this device is shared."
      onScan={note("scan")} onSelect={id=>note("select "+id)()} onStopSearch={note("stop")} onClose={note("close")}
      onRetry={note("retry")} onDone={note("done")} onOpenSettings={note("settings")}/>
  </View>;
}

document.documentElement.dataset.theme=params.get("theme")??"light";
document.documentElement.dir=params.get("dir")==="rtl"?"rtl":"ltr";
const dir=document.documentElement.dir as "rtl"|"ltr";
function Root(){return <View {...{dir}} style={{flex:1}}><PairingFixture/></View>;}
AppRegistry.registerComponent("PairingAcceptance",()=>Root);
AppRegistry.runApplication("PairingAcceptance",{rootTag:document.getElementById("root")});
