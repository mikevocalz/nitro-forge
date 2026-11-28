import {View,type ViewProps} from 'react-native';
import {EffectStackAndInspector,type EffectStackAndInspectorProps} from '../motion/EffectStackAndInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface AudioEffectsPresetPanelProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 stack:Omit<EffectStackAndInspectorProps,'scope'|'revision'|'disabled'|'unstyled'>;bypassed:boolean;
 previewStatus:'idle'|'rendering'|'ready'|'error';previewError?:string;onRenderPreview:(signal?:AbortSignal)=>unknown;onCancelPreview:()=>void;
 onAuditionPreview:(signal?:AbortSignal)=>unknown;onBypassCommit:(bypassed:boolean,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Audio-specific lifecycle around the shared parameter/preset/effect-stack owner. */
export function AudioEffectsPresetPanel({scope='audio-effects',revision=0,...props}:AudioEffectsPresetPanelProps){
 const {stack,bypassed,previewStatus,previewError,onRenderPreview:_render,onCancelPreview,onAuditionPreview:_audition,onBypassCommit:_bypass,unstyled=false,disabledReason,style,...rest}=props;
 if(!['idle','rendering','ready','error'].includes(previewStatus))throw new RangeError('Invalid audio preview status');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||previewStatus==='rendering'),off=guard.pending||disabledReason!==undefined||previewStatus==='rendering';
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]} accessibilityLabel="Audio effects and presets">
  <EffectStackAndInspector {...stack} scope={scope} revision={revision} disabled={off} unstyled={unstyled} onSelect={id=>guard.current()?.stack.onSelect(id)} onMutation={async m=>{await guard.run('effect',(h,s)=>h.stack.onMutation(m,s));}}/>
  <Button title={bypassed?'Enable clip audio effects':'Bypass clip audio effects'} disabled={off} unstyled={unstyled} onPress={()=>guard.run('bypass',(h,s)=>h.onBypassCommit(!h.bypassed,s))}/>
  <Button title="Render offline audio preview" disabled={off} unstyled={unstyled} onPress={()=>guard.run('render',(h,s)=>h.onRenderPreview(s))}/>
  {previewStatus==='rendering'||guard.pendingId==='render'?<Button title="Cancel offline preview" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancelPreview();}}/>:null}
  <Button title="Audition rendered preview" disabled={off||previewStatus!=='ready'} unstyled={unstyled} onPress={()=>guard.run('audition',(h,s)=>h.previewStatus==='ready'?h.onAuditionPreview(s):undefined)}/>
  <ErrorMessage {...exact({message:guard.error??previewError??disabledReason,unstyled:unstyled})}/>
 </View>;
}
