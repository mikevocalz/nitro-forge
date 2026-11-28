import type {ReactNode} from 'react';
import {View} from 'react-native';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface PBRMaterial {baseColor:string;roughness:number;metallic:number;normalScale:number;emissiveColor:string;emissiveIntensity:number;opacity:number;doubleSided:boolean}
export interface PBRMaterialInspectorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:PBRMaterial;renderMaterial:()=>ReactNode;onCommit:(value:PBRMaterial,signal?:AbortSignal)=>unknown}
export function PBRMaterialInspector({value,renderMaterial,onCommit,...props}:PBRMaterialInspectorProps){return <View style={{gap:8}}><View style={{height:220}}>{renderMaterial()}</View><PropertyInspector {...props} label="PBR material" fields={[
 {kind:'text',id:'baseColor',label:'Base color expression',value:value.baseColor,maxLength:256},{kind:'text',id:'emissiveColor',label:'Emissive color expression',value:value.emissiveColor,maxLength:256},
 ...(['roughness','metallic','opacity'] as const).map(id=>({kind:'number' as const,id,label:id,value:value[id],min:0,max:1,step:.01})),{kind:'number',id:'normalScale',label:'Normal intensity',value:value.normalScale,min:0,max:10,step:.01},{kind:'number',id:'emissiveIntensity',label:'Emissive intensity',value:value.emissiveIntensity,min:0,max:100000,step:.1},{kind:'boolean',id:'doubleSided',label:'Double sided',value:value.doubleSided}
 ]} onCommit={(id,v,s)=>onCommit({...value,[id]:v},s)}/></View>;}
