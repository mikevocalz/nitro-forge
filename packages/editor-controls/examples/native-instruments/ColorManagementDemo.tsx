import {  ScrollView, Text, View } from 'react-native';
import {useRef} from 'react';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import { PrintColorChannels } from '@nitro-forge/editor-controls/color/PrintColorChannels';
import { WideGamutChannels } from '@nitro-forge/editor-controls/color/WideGamutChannels';
import { ColorSpaceChooser } from '@nitro-forge/editor-controls/color/ColorSpaceChooser';
import { GamutWarning } from '@nitro-forge/editor-controls/color/GamutWarning';
import { ThemeColorReferences } from '@nitro-forge/editor-controls/color/ThemeColorReferences';
import { SpotAndGlobalColorEditor } from '@nitro-forge/editor-controls/color/SpotAndGlobalColorEditor';
import { SoftProofControls } from '@nitro-forge/editor-controls/color/SoftProofControls';
import { TabBar } from '@nyc-tron/ui/components/TabBar';
import type { PrintColor, ColorConversionPolicy, WideGamutColor, NamedColor, SoftProofSettings } from '@nitro-forge/editor-controls/color/color-management';
const profiles=[{id:'press',label:'Coated press',model:'cmyk' as const},{id:'p3',label:'Display P3',model:'rgb' as const}];
const createDemo=()=>createStore<{tab:string;print:PrintColor;lab:PrintColor;policy:ColorConversionPolicy;wide:WideGamutColor;profile:string;reference:string|null;ink:NamedColor;proof:SoftProofSettings;saved:string;inspect:number}>(()=>({
 tab:'print',policy:'preserve-numbers',lab:{model:'lab',profileId:'icc:lab',channels:[50,-45,80],alpha:.5},print:{profileId:'press',channels:[10,20,30,40],alpha:.8},wide:{profileId:'p3',channels:[-.2,2,1.25],alpha:1},profile:'p3',reference:'brand',
 ink:{id:'ink1',name:'Brand ink',kind:'spot',tint:75,alternate:{r:20,g:100,b:200,alpha:1}},proof:{enabled:false,profileId:null,intent:'relative-colorimetric',blackPointCompensation:true,simulatePaper:false,simulateBlackInk:false},saved:'',inspect:0,
}));
export function ColorManagementDemo({ fail = false }: {readonly fail?:boolean}){const local=useRef<ReturnType<typeof createDemo>|null>(null);local.current??=createDemo();const store=local.current;const s=useStore(store,value=>value);return <ScrollView contentContainerStyle={{padding:16,gap:12,maxWidth:640,width:'100%'}}>
 <TabBar tabs={['print','lab','wide','profiles','references','ink','proof'].map(key=>({key,label:key,active:key===s.tab,onPress:()=>store.setState({tab:key})}))}/>
 {s.tab==='print'?<PrintColorChannels value={s.print} conversionPolicy={s.policy} onConversionPolicyChange={policy=>store.setState({policy})} onCommit={print=>store.setState({print})}/>:null}
 {s.tab==='lab'?<PrintColorChannels value={s.lab} conversionPolicy={s.policy} onConversionPolicyChange={policy=>store.setState({policy})} onCommit={lab=>store.setState({lab})}/>:null}
 {s.tab==='wide'?<WideGamutChannels value={s.wide} onCommit={wide=>store.setState({wide})}/>:null}
 {s.tab==='profiles'?<View style={{gap:12}}><ColorSpaceChooser profiles={profiles} value={s.profile} onProfileChange={profile=>store.setState({profile})}/><GamutWarning report={{sourceProfileId:'p3',destinationProfileId:'press',outside:25,total:100,maximumDeltaE:3.4,comparison:{original:{profileId:'p3',channels:[-.2,2,.5],alpha:1,preview:{r:0,g:255,b:128,alpha:1}},mapped:{profileId:'press',channels:[0,75,25,10],alpha:1,preview:{r:30,g:180,b:100,alpha:1}}}}} onInspect={()=>store.setState({inspect:s.inspect+1})}/></View>:null}
 {s.tab==='references'?<ThemeColorReferences referenceId={s.reference} references={[{id:'brand',label:'Brand',source:'Theme',preview:{r:20,g:100,b:200,alpha:1}},{id:'accent',label:'Accent',source:'Theme',preview:{r:100,g:20,b:200,alpha:1}}]} onBind={reference=>store.setState({reference})} onDetach={()=>store.setState({reference:null})}/>:null}
 {s.tab==='ink'?<SpotAndGlobalColorEditor value={s.ink} onChange={ink=>store.setState({ink})} onSave={async ink=>{if(fail)throw Error('Ink definition rejected');store.setState({saved:ink.name});}}/>:null}
 {s.tab==='proof'?<SoftProofControls profiles={profiles} value={s.proof} onCommit={proof=>store.setState({proof})}/>:null}
 <Text accessibilityLabel={`Consumer document state: ${JSON.stringify(s)}`} {...{className:"text-text-muted"}} testID="consumer-state">{JSON.stringify(s)}</Text>
 </ScrollView>;}
