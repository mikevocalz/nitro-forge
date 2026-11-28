import {useRef} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {TabBar} from '@nyc-tron/ui/components/TabBar';
import {Transform3DInspector} from '@nitro-forge/editor-controls/motion/Transform3DInspector';
import {CameraAndLightControls} from '@nitro-forge/editor-controls/motion/CameraAndLightControls';
import {MatteAndMaskPanel} from '@nitro-forge/editor-controls/motion/MatteAndMaskPanel';
import {ParticleEmitterControls} from '@nitro-forge/editor-controls/motion/ParticleEmitterControls';
import {defaultMotionTransform,type MotionCamera,type MotionLight,type MotionMatte,type MotionParticleEmitter} from '@nitro-forge/editor-controls/motion/motion-settings';
const makeStore=()=>createStore(()=>({section:'Transform' as 'Transform'|'Camera'|'Matte'|'Particles',transform:defaultMotionTransform(),camera:{position:{x:0,y:0,z:10},target:{x:0,y:0,z:0},projection:'perspective',focalLengthMm:50,sensorWidthMm:36,near:.1,far:10000,orthographicSize:10,depthOfField:false,focusDistance:10,aperture:2.8} as MotionCamera,light:{type:'point',position:{x:10,y:20,z:30},rotation:{x:0,y:0,z:0},intensity:1,colorProfileId:'scene-linear-acescg',color:[1,1,1],coneDegrees:45,castsShadows:true} as MotionLight,matte:{sourceId:null,mode:'alpha',enabled:false,feather:0} as MotionMatte,particles:{enabled:false,rate:20,lifetime:3,speed:10,spreadDegrees:45,gravity:{x:0,y:9.8,z:0},seed:1234,textureId:null,size:4,opacity:1} as MotionParticleEmitter,commits:0}));
/** Typed scene values only; this standalone fixture is not a compositor or particle simulation. */
export function MotionSettingsDemo(){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 return <View style={{padding:16,gap:8,width:'100%',maxWidth:680,flex:1}}>
  <TabBar tabs={(['Transform','Camera','Matte','Particles'] as const).map(key=>({key,label:key,active:s.section===key,onPress:()=>store.setState({section:key})}))}/>
  <ScrollView style={{maxHeight:700}} contentContainerStyle={{gap:8}} keyboardShouldPersistTaps="handled">
   {s.section==='Transform'?<Transform3DInspector value={s.transform} onCommit={transform=>store.setState(s=>({transform,commits:s.commits+1}))}/>:null}
   {s.section==='Camera'?<CameraAndLightControls camera={s.camera} light={s.light} onCameraCommit={camera=>store.setState(s=>({camera,commits:s.commits+1}))} onLightCommit={light=>store.setState(s=>({light,commits:s.commits+1}))}/>:null}
   {s.section==='Matte'?<MatteAndMaskPanel layerId="target" value={s.matte} sources={[{id:'target',label:'Self layer'},{id:'footage',label:'Footage alpha'},{id:'nested',label:'Nested comp',unavailableReason:'Would create a cycle'}]} onCommit={matte=>store.setState(s=>({matte,commits:s.commits+1}))}/>:null}
   {s.section==='Particles'?<ParticleEmitterControls value={s.particles} textures={[{id:'spark',label:'Spark image'}]} onCommit={particles=>store.setState(s=>({particles,commits:s.commits+1}))}/>:null}
  </ScrollView>
  <Text numberOfLines={3} testID="motion-settings-state" accessibilityLabel={`Motion settings state ${JSON.stringify(s)}`} {...{className:'text-text'}}>{JSON.stringify(s)}</Text>
 </View>;
}
