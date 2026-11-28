import {useLayoutEffect,useRef} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {MenuButton} from '@nyc-tron/ui/components/shell/MenuButton';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {defaultAlphaModes,layerBlendProblem,layerOpacityFromPercent,validateLayerBlend,type LayerAlphaMode,type LayerAlphaOption,type LayerBlendMode,type LayerBlendSpace,type LayerBlendValue} from './layer-blend-model.ts';
export type {LayerAlphaMode,LayerAlphaOption,LayerBlendMode,LayerBlendSpace,LayerBlendValue} from './layer-blend-model.ts';
export {defaultAlphaModes} from './layer-blend-model.ts';
export interface LayerBlendAndOpacityProps extends Omit<ViewProps,'children'> {
 scope:string;revision?:string|number;layerId:string;value:LayerBlendValue;
 modes:readonly LayerBlendMode[];spaces:readonly LayerBlendSpace[];
 /**
  * Alpha representations the compositor accepts, one or two entries.
  * One entry renders as plain text instead of a menu. An entry with
  * `unavailableReason` is listed disabled with its reason. When every entry
  * is unavailable the control renders as text too, so no menu opens onto
  * nothing. `value.alphaMode` must be in the catalog.
  * @default defaultAlphaModes (Straight and Premultiplied, both available)
  * @throws {RangeError} Through {@linkcode validateLayerBlend}: empty, more than two, duplicate or unknown ids, or a current value outside the catalog.
  */
 alphaModes?:readonly LayerAlphaOption[];
 onPreview?:(value:LayerBlendValue)=>void;
 /** One host transaction. Respect the signal before applying an asynchronous result. */
 onCommit:(value:LayerBlendValue,detail:{kind:'mode'|'opacity'|'space'|'alpha'},signal:AbortSignal)=>void|Promise<void>;
 disabled?:boolean;className?:string;unstyled?:boolean;
}
/** Compositing policy requests, not document-profile assignment or pixel conversion. */
export function LayerBlendAndOpacity({scope,revision=0,layerId,value,modes,spaces,alphaModes,onPreview,onCommit,disabled=false,className,unstyled=false,style,...rest}:LayerBlendAndOpacityProps){
 validateLayerBlend(value,modes,spaces,alphaModes);if(!scope.trim()||scope.length>512||!layerId.trim()||layerId.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid layer blend identity');
 // Omitted alphaModes keeps the rc.1 owner key, so existing hosts see no remount.
 const owner=JSON.stringify([scope,revision,layerId,disabled,modes,spaces,...(alphaModes===undefined?[]:[alphaModes])]),boundary=JSON.stringify([owner,value]),action=useOwnedAction(owner),pending=action.pending!==null;
 const committed=useRef<null|{boundary:string;onPreview:typeof onPreview;onCommit:typeof onCommit}>(null),request=useRef<symbol|null>(null);
 useLayoutEffect(()=>{committed.current={boundary,onPreview,onCommit};});useLayoutEffect(()=>{request.current=null;return()=>{request.current=null;};},[owner]);useLayoutEffect(()=>()=>{committed.current=null;},[]);
 const current=()=>!disabled&&!pending&&committed.current?.boundary===boundary?committed.current:null;
 const commit=(patch:Partial<LayerBlendValue>,kind:'mode'|'opacity'|'space'|'alpha')=>{const p=current();if(!p||request.current)return Promise.resolve();const next={...value,...patch};if(layerBlendProblem(next,modes,spaces,alphaModes)||JSON.stringify(next)===JSON.stringify(value))return Promise.resolve();const token=Symbol();request.current=token;return action.run(kind,signal=>p.onCommit(next,{kind},signal)).then(()=>{}).finally(()=>{if(request.current===token)request.current=null;});};
 const problem=layerBlendProblem(value,modes,spaces,alphaModes),space=spaces.find(space=>space.id===value.spaceId)!;
 // A blend-mode or space problem locks the alpha menu as in rc.1. An unavailable current alpha locks the mode and space menus instead, so the alpha menu is the one way out.
 const blendProblem=alphaModes===undefined?problem:layerBlendProblem(value,modes,spaces);
 const alphaCatalog:readonly LayerAlphaOption[]=alphaModes??defaultAlphaModes,alpha=alphaCatalog.find(item=>item.id===value.alphaMode)!;
 const alphaMenu=alphaCatalog.length>1&&alphaCatalog.some(item=>!item.unavailableReason),alphaProblem=!!problem&&!blendProblem;
 // Reasons stay on screen whenever the menu can't show them: text mode, a locked menu, or a current reason the alert line doesn't carry.
 const alphaLocked=!alphaMenu||disabled||!!blendProblem,alphaNotes=alphaModes===undefined?[]:alphaCatalog.filter(item=>item.unavailableReason&&(item===alpha?problem!==item.unavailableReason:alphaLocked));
 const alphaControl=<MenuButton key={alphaNotes.length?'menu':undefined} label="Layer alpha representation" editScope={JSON.stringify([scope,revision,layerId,'alpha'])} accessibilityValue={{text:alpha.label}} items={alphaCatalog.map(item=>({id:item.id,label:item.label,...(item.unavailableReason?{description:item.unavailableReason,disabled:true}:{})}))} disabled={disabled||pending||!!blendProblem} unstyled={unstyled} onSelect={alphaMode=>{if(alphaCatalog.some(item=>item.id===alphaMode&&!item.unavailableReason))void commit({alphaMode:alphaMode as LayerAlphaMode},'alpha');}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{alpha.label}</Text></MenuButton>;
 return <View key={owner} {...rest} {...{className:joinClasses(className)}} style={[{gap:8},style]}>
  <Text {...{className:joinClasses(!unstyled&&'text-text')}}>Layer blend mode</Text>
  <MenuButton label="Layer blend mode" editScope={JSON.stringify([scope,revision,layerId,'mode'])} accessibilityValue={{text:modes.find(mode=>mode.id===value.mode)!.label}} items={modes.map(mode=>({id:mode.id,label:mode.label,...(mode.unavailableReason?{description:mode.unavailableReason}:{}),disabled:!!mode.unavailableReason||!!space.unavailableReason||!space.modeIds.includes(mode.id)}))} disabled={disabled||pending||alphaProblem} unstyled={unstyled} onSelect={mode=>{if(modes.some(item=>item.id===mode))void commit({mode},'mode');}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{modes.find(mode=>mode.id===value.mode)!.label}</Text></MenuButton>
  <PrecisionScrubber key={JSON.stringify([value.mode,value.spaceId,value.alphaMode])} scope={layerId} revision={revision} label="Layer opacity" value={value.opacity*100} min={0} max={100} step={.0001} detents={[0,25,50,75,100]} unit="%" disabled={disabled||pending||!!problem} unstyled={unstyled} onPreview={percent=>{const p=current();if(p&&!problem)p.onPreview?.({...value,opacity:layerOpacityFromPercent(percent)});}} onCommit={percent=>commit({opacity:layerOpacityFromPercent(percent)},'opacity')}/>
  <Text {...{className:joinClasses(!unstyled&&'text-text')}}>Layer compositing space</Text>
  <MenuButton label="Layer compositing space" editScope={JSON.stringify([scope,revision,layerId,'space'])} accessibilityValue={{text:space.label+' ('+space.transfer+')'}} items={spaces.map(item=>({id:item.id,label:item.label+' ('+item.transfer+')',...(item.unavailableReason?{description:item.unavailableReason}:{}),disabled:!!item.unavailableReason||!item.modeIds.includes(value.mode)}))} disabled={disabled||pending||alphaProblem} unstyled={unstyled} onSelect={spaceId=>{if(spaces.some(item=>item.id===spaceId))void commit({spaceId},'space');}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{space.label+' ('+space.transfer+')'}</Text></MenuButton>
  <Text {...{className:joinClasses(!unstyled&&'text-text')}}>Layer alpha representation</Text>
  {alphaMenu&&!alphaNotes.length?alphaControl:[alphaMenu?alphaControl:<Text key="current" {...{className:joinClasses(!unstyled&&'text-text')}}>{alpha.label}</Text>,...alphaNotes.map(item=><Text key={item.id} {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{item.label+': '+item.unavailableReason}</Text>)]}
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{space.transfer==='linear'?'Blend calculations use the host’s named linear space.':'Blend calculations use the host’s named encoded space.'} Changing this policy requests a compositor update; the document color profile stays host-owned.</Text>
  {problem?<Text accessibilityRole="alert" {...{className:joinClasses(!unstyled&&'text-text')}}>{problem}</Text>:null}
  {pending?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Updating layer compositing</Text>:null}<ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
