import type {ReactNode} from 'react';
import {Text,View} from 'react-native';
import {EffectStackAndInspector,type EffectStackAndInspectorProps} from '../motion/EffectStackAndInspector.tsx';
import {Select} from '@nyc-tron/ui/components/Select';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface VideoEffectsBrowserProps extends EffectStackAndInspectorProps {
 clipId:string;preview:ReactNode;appearance:{intensity:number;maskId:string|null};masks:readonly {id:string;label:string}[];
 onAppearanceChange:(value:{intensity:number;maskId:string|null},signal?:AbortSignal)=>void|Promise<unknown>;
}
/** Reuses the schema-driven effect owner; actual video/body-effect rendering stays with the host. */
export function VideoEffectsBrowser({clipId,preview,appearance,masks,onAppearanceChange:_appearance,...props}:VideoEffectsBrowserProps){
 if(!clipId.trim()||clipId.length>512||!Number.isFinite(appearance.intensity)||appearance.intensity<0||appearance.intensity>1||masks.length>256||new Set(masks.map(m=>m.id)).size!==masks.length||masks.some(m=>!m.id.trim()||!m.label.trim()))throw new RangeError('Invalid video effect context');
 const host={...props,appearance,onAppearanceChange:_appearance},owner=JSON.stringify([...controlIdentity(props.scope,props.revision),clipId,props.disabled]);
 const guard=useScopedControl(owner,host,!!props.disabled),off=!!props.disabled||guard.pending;
 const set=(patch:Partial<typeof appearance>)=>guard.run('appearance',(current,signal)=>current.onAppearanceChange({...current.appearance,...patch},signal));
 return <View style={{gap:tokens.spacing.fixedElement,minWidth:0}} accessibilityLabel="Video effects">
  {preview}<Text {...{className:props.unstyled?undefined:'text-text'}}>Clip: {clipId}</Text>
  <EffectStackAndInspector key={owner} {...props} disabled={off} onSelect={id=>guard.current()?.onSelect(id)}
   onMutation={(mutation,signal)=>{const current=guard.current();return current?.onMutation(mutation,signal);}}/>
  <PrecisionScrubber scope={props.scope} revision={props.revision} label="Effect intensity" value={appearance.intensity} min={0} max={1} step={.01} disabled={off} {...exact({unstyled:props.unstyled})} onCommit={intensity=>set({intensity})}/>
  <Select label="Effect mask" value={appearance.maskId??''} options={[{value:'',label:'No mask'},...masks.map(m=>({value:m.id,label:m.label}))]} disabled={off} {...exact({unstyled:props.unstyled})} onValueChange={maskId=>set({maskId:maskId||null})}/>
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:props.unstyled})}/>
 </View>;
}
