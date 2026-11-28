import {useLayoutEffect,useRef,type ComponentRef} from 'react';
import {Platform,Pressable,Text,View,type ViewProps} from 'react-native';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {nodeIsRTL,shellKey} from '@nyc-tron/ui/components/shell/shell-keys';
import {MOTION_EASING_PRESETS,validateMotionEasingPresets,type MotionEasingKind,type MotionEasingPreset} from './motion-easing.ts';
export type {MotionEasing,MotionEasingKind,MotionEasingPreset} from './motion-easing.ts';
export interface EasingPresetGalleryProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly selectedId:string|null;readonly supported:readonly MotionEasingKind[];
 readonly onSelect:(preset:MotionEasingPreset)=>void;readonly onPreview?:(preset:MotionEasingPreset|undefined)=>void;
 readonly presets?:readonly MotionEasingPreset[];readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Complete typed easing intents. Spring is actionable only when the host evaluator supports it. */
export function EasingPresetGallery({scope,selectedId,supported,onSelect,onPreview,presets=MOTION_EASING_PRESETS,disabled=false,unstyled=false,...props}:EasingPresetGalleryProps){
 validateMotionEasingPresets(presets);if(!scope.trim()||supported.some(kind=>!['hold','linear','bezier','spring'].includes(kind))||new Set(supported).size!==supported.length)throw new TypeError('Invalid easing scope or evaluator capabilities');
 const [local,store]=useLocalStore(()=>({focusId:null as string|null}));
 const refs=useRef(new Map<string,ComponentRef<typeof Pressable>|null>());
 useLayoutEffect(()=>()=>onPreview?.(undefined),[scope,supported.join(',')]);
 useLayoutEffect(()=>{if(disabled)onPreview?.(undefined);},[disabled]);
 const available=presets.filter(preset=>supported.includes(preset.value.kind));
 const chosen=available.some(p=>p.id===local.focusId)?local.focusId:available.some(p=>p.id===selectedId)?selectedId:available[0]?.id;
 const key=(id:string,event:unknown)=>{if(disabled)return;const k=shellKey(event);if(k.altKey||k.ctrlKey||k.metaKey)return;const index=available.findIndex(p=>p.id===id),rtl=nodeIsRTL(k.target);const next=k.key==='Home'?0:k.key==='End'?available.length-1:k.key==='ArrowRight'||k.key==='ArrowDown'?index+(rtl&&k.key==='ArrowRight'?-1:1):k.key==='ArrowLeft'||k.key==='ArrowUp'?index+(rtl&&k.key==='ArrowLeft'?1:-1):null;if(next===null)return;k.preventDefault();const target=available[Math.max(0,Math.min(available.length-1,next))];if(target)refs.current.get(target.id)?.focus();};
 return <View {...props} accessibilityRole="radiogroup" accessibilityLabel="Motion easing presets" style={[{flexDirection:'row',flexWrap:'wrap',gap:8},props.style]}>
  {presets.map(preset=>{const supportedPreset=supported.includes(preset.value.kind),off=disabled||!supportedPreset,selected=preset.id===selectedId;return <Pressable key={preset.id} ref={ref=>{if(ref)refs.current.set(preset.id,ref);else refs.current.delete(preset.id);}} accessibilityRole="radio" accessibilityLabel={preset.label} accessibilityState={{checked:selected,disabled:off}} accessibilityHint={!supportedPreset?"This composition evaluator does not support this easing kind":undefined} aria-checked={selected} disabled={off}
   onPress={()=>{if(!off)onSelect(preset);}} onHoverIn={()=>{if(!off)onPreview?.(preset);}} onHoverOut={()=>onPreview?.(undefined)} onFocus={()=>{if(!off){store.set({focusId:preset.id});onPreview?.(preset);}}} onBlur={()=>onPreview?.(undefined)} {...(Platform.OS==='web'?{tabIndex:off?-1:preset.id===chosen?0:-1,onKeyDown:(event:unknown)=>key(preset.id,event)}:{})}
   style={{minHeight:56,minWidth:120,flexBasis:144,flexGrow:1,padding:10,gap:4,opacity:off?.5:1}} {...{className:joinClasses(!unstyled&&'border border-border rounded-control focus-visible:ring-2 focus-visible:ring-focus',!unstyled&&selected&&'bg-surface-raised')}}>
    <Text {...{className:joinClasses(!unstyled&&'text-text')}}>{preset.label}</Text>
    {!supportedPreset?<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Unsupported by this evaluator</Text>:null}
  </Pressable>;})}
 </View>;
}
