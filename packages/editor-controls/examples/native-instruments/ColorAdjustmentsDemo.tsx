import {ScrollView,Text,View} from 'react-native';import {useRef} from 'react';import {createStore} from 'zustand/vanilla';import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {LevelsEditor} from '@nitro-forge/editor-controls/color/LevelsEditor';
import {CurvesEditor} from '@nitro-forge/editor-controls/color/CurvesEditor';
import {GradientStopEditor} from '@nitro-forge/editor-controls/color/GradientStopEditor';
import {GradientMeshEditor} from '@nitro-forge/editor-controls/color/GradientMeshEditor';
import {ColorGradingWheels} from '@nitro-forge/editor-controls/color/ColorGradingWheels';
import {HSLSecondaryEditor} from '@nitro-forge/editor-controls/color/HSLSecondaryEditor';
import {VideoScopesPanel} from '@nitro-forge/editor-controls/color/VideoScopesPanel';
import {HueSlider} from '@nitro-forge/editor-controls/color/HueSlider';
import {SVColorField} from '@nitro-forge/editor-controls/color/SVColorField';
import {EyedropperTool} from '@nitro-forge/editor-controls/color/EyedropperTool';
import type {GradientOptions} from '@nitro-forge/editor-controls/color/gradient-options';
import type {GradientMesh} from '@nitro-forge/editor-controls/color/gradient-mesh';
import type {ColorGrade} from '@nitro-forge/editor-controls/color/color-adjustments';
import type {ColorCurve} from '@nitro-forge/editor-controls/color/color-adjustments';
import type {GradientPaint} from '@nitro-forge/editor-controls/vector/vector-types';
const band={hue:0,saturation:0,exposureEv:0},color={r:20,g:100,b:200,alpha:1};
const initial={curveChannel:'rgb' as 'rgb'|'luma',lumaCurve:{interpolation:'linear' as const,points:[{id:'black',x:0,y:0},{id:'mid',x:.5,y:.5},{id:'white',x:1,y:1}]},tab:'curves',revision:1,commits:0,preview:null as unknown,selected:'mid',seq:0,
 curve:{interpolation:'monotone' as const,points:[{id:'black',x:0,y:0},{id:'mid',x:.5,y:.7},{id:'white',x:1,y:1}]},
 levels:{inputBlack:0,inputWhite:1,gamma:1,outputBlack:0,outputWhite:1},
 gradientOptions:{interpolation:'srgb' as const,midpoints:[.5]},
 paint:{type:'linear' as const,x0:0,y0:0,x1:100,y1:0,stops:[{offset:0,color:[0,0,0,255] as const},{offset:1,color:[255,255,255,255] as const}]},stop:0,
 mesh:{rows:2,columns:2,points:[{id:'a',x:0,y:0,color:{r:255,g:0,b:0,alpha:1}},{id:'b',x:1,y:0,color:{r:0,g:255,b:0,alpha:1}},{id:'c',x:0,y:1,color:{r:0,g:0,b:255,alpha:1}},{id:'d',x:1,y:1,color:{r:255,g:255,b:255,alpha:1}}]},meshId:'a',
 grade:{shadows:band,midtones:band,highlights:band,balance:0,blend:1},
 hsl:{enabled:true,hueStart:340,hueEnd:20,hueFeather:10,saturationMin:0,saturationMax:1,luminanceMin:0,luminanceMax:1,softness:.1,denoise:0,hueShift:0,saturationShift:0,luminanceShift:0,showMask:false,invert:false},
 mode:'histogram' as 'histogram'|'waveform'|'vectorscope'|'rgb-parade',hsv:{h:120,s:.5,v:.5,alpha:.75},sample:{documentId:'image',revision:'1',sourceId:'composite',x:20,y:30,radius:0},applied:null as unknown,
};
// Controlled unions permit the public components to return every supported variant.
type Demo=Omit<typeof initial,'curve'|'lumaCurve'|'grade'|'paint'|'mesh'|'gradientOptions'>&{curve:ColorCurve;lumaCurve:ColorCurve;grade:ColorGrade;paint:GradientPaint;mesh:GradientMesh;gradientOptions:GradientOptions};
const createDemo=()=>createStore<Demo>(()=>({...initial}));
export function ColorAdjustmentsDemo({ fail = false }: {readonly fail?:boolean}){const local=useRef<ReturnType<typeof createDemo>|null>(null);local.current??=createDemo();const store=local.current;const s=useStore(store,value=>value);const commit=(change:Partial<Demo>)=>store.setState(s=>({...change,commits:s.commits+1,revision:s.revision+1,preview:null}));return <ScrollView contentContainerStyle={{padding:16,gap:12,width:'100%',maxWidth:640}}>
 <TabBar tabs={['curves','levels','gradient','mesh','grade','secondary','scopes','field','sample'].map(key=>({key,label:key,active:s.tab===key,onPress:()=>store.setState({tab:key})}))}/>
 {s.tab==='curves'?<CurvesEditor scope={`${s.revision}:${s.curveChannel}`} value={s.curveChannel==='rgb'?s.curve:s.lumaCurve} channelSelection={{channels:[{id:'rgb',label:'RGB'},{id:'luma',label:'Luma'}],value:s.curveChannel,onChange:channel=>store.setState({curveChannel:channel as 'rgb'|'luma',selected:'mid'})}} presets={[{id:'contrast',label:'Contrast',curve:{interpolation:'monotone',points:[{id:'black',x:0,y:0},{id:'mid',x:.5,y:.8},{id:'white',x:1,y:1}]}}]} selectedId={s.selected} onSelect={selected=>store.setState({selected})} createPointId={()=>{const seq=store.getState().seq+1;store.setState({seq});return `p${seq}`;}} onPreview={preview=>store.setState({preview:preview??null})} onCommit={(curve,selected)=>commit(s.curveChannel==='rgb'?{curve,selected}:{lumaCurve:curve,selected})}/>:null}
 {s.tab==='levels'?<LevelsEditor value={s.levels} onCommit={levels=>commit({levels})}/>:null}
 {s.tab==='gradient'?<GradientStopEditor value={s.paint} options={s.gradientOptions} selectedIndex={s.stop} onSelect={stop=>store.setState({stop})} onCommit={(paint,stop,gradientOptions)=>commit({paint,stop,gradientOptions})}/>:null}
 {s.tab==='mesh'?<GradientMeshEditor testID="mesh-editor" scope={String(s.revision)} value={s.mesh} selectedId={s.meshId} onSelect={meshId=>store.setState({meshId})} onPreview={preview=>store.setState({preview:preview??null})} onCommit={mesh=>commit({mesh})}/>:null}
 {s.tab==='grade'?<ColorGradingWheels value={s.grade} onPreview={preview=>store.setState({preview:preview??null})} onCommit={grade=>commit({grade})}/>:null}
 {s.tab==='secondary'?<HSLSecondaryEditor value={s.hsl} onCommit={hsl=>commit({hsl})}/>:null}
 {s.tab==='scopes'?<VideoScopesPanel frameTimeUs={125000} mode={s.mode} onModeChange={mode=>store.setState({mode})} histogram={[{id:'luma',label:'Luminance',bins:[0,5,10,5,0],clipping:{low:1,high:2}}]} domain={[0,1]} waveform={[{x:0,y:.5,intensity:1},{x:1,y:0,intensity:.5}]} vectorscope={[{x:.5,y:.5,intensity:.5}]} parade={(['red','green','blue'] as const).map(id=>({id,samples:[{x:.25,y:.5,intensity:.75}]}))}/>:null}
 {s.tab==='field'?<View style={{gap:8}}><SVColorField value={s.hsv} onPreview={preview=>store.setState({preview})} onCommit={hsv=>commit({hsv})}/><HueSlider value={s.hsv} onPreview={preview=>store.setState({preview})} onCommit={hsv=>commit({hsv})}/></View>:null}
 {s.tab==='sample'?<EyedropperTool request={s.sample} documentWidth={100} documentHeight={100} sources={[{id:'composite',label:'Merged document'},{id:'layer:1',label:'Selected layer'}]} onRequestChange={sample=>store.setState({sample})} onSample={async()=>{if(fail)throw Error('Document sampler unavailable');return {profileId:'linear:p3',channels:[-.2,2,.25],alpha:.75,preview:color};}} onApply={(sample,request)=>commit({applied:{sample,request}})}/>:null}
 <Text accessibilityLabel={`Consumer document state: ${JSON.stringify(s)}`} {...{className:"text-text-muted"}} testID="consumer-state">{JSON.stringify(s)}</Text>
 </ScrollView>;}
