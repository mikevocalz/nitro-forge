import {View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {MotionVectorFields} from './MotionVectorFields.tsx';
import {validateMotionParticles,type MotionParticleEmitter} from './motion-settings.ts';
export type {MotionParticleEmitter} from './motion-settings.ts';
export interface ParticleEmitterControlsProps extends Omit<ViewProps,'children'> {readonly value:MotionParticleEmitter;readonly textures:readonly {readonly id:string;readonly label:string}[];readonly onCommit:(value:MotionParticleEmitter)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Deterministic emitter settings; the compositor owns particle simulation and texture resources. */
export function ParticleEmitterControls({value,textures,onCommit,disabled=false,unstyled=false,...props}:ParticleEmitterControlsProps){
 validateMotionParticles(value);const ids=new Set<string>();for(const texture of textures){if(!texture.id.trim()||!texture.label.trim()||ids.has(texture.id))throw new TypeError('Particle textures require unique identities');ids.add(texture.id);}
 const set=(change:Partial<MotionParticleEmitter>)=>{if(disabled)return;const next={...value,...change};validateMotionParticles(next);onCommit(next);};
 const options=[{value:'',label:'No texture'},...textures.map(texture=>({value:texture.id,label:texture.label}))];if(value.textureId!==null&&!ids.has(value.textureId))options.push({value:value.textureId,label:`Unavailable texture: ${value.textureId}`});
 return <View {...props} style={[{gap:8},props.style]}>
  <SettingSwitch label="Enable particle emitter" on={value.enabled} onChange={enabled=>set({enabled})} disabled={disabled} styled={!unstyled}/>
  {([['rate','Particles per second',0,100000,1],['lifetime','Particle lifetime seconds',.001,86400,.1],['speed','Particle initial speed',0,1e6,1],['spreadDegrees','Particle spread degrees',0,360,1],['size','Particle size',.001,100000,1],['opacity','Particle opacity',0,1,.01],['seed','Particle random seed',0,4294967295,1]] as const).map(([key,label,min,max,step])=><UnitInput key={key} label={label} value={value[key]} min={min} max={max} step={step} precision={key==='seed'?0:3} disabled={disabled} unstyled={unstyled} onCommit={number=>set({[key]:key==='seed'?Math.round(number):number})}/>)}
  <MotionVectorFields label="Particle gravity" value={value.gravity} min={-100000} max={100000} step={.1} disabled={disabled} unstyled={unstyled} onCommit={gravity=>set({gravity})}/>
  <Select label="Particle texture" value={value.textureId??''} options={options} disabled={disabled} unstyled={unstyled} onValueChange={textureId=>set({textureId:textureId||null})}/>
 </View>;
}
