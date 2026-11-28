import {useRef,useLayoutEffect} from 'react';
import {TextInput,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface FormulaBarProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 address:string;value:string;originalValue:string;onChange:(raw:string)=>void;
 onCommit:(raw:string,signal?:AbortSignal)=>unknown;onCancel:()=>void;pending?:boolean;readOnly?:boolean;hideActions?:boolean;unstyled?:boolean;
}
/** Controlled formula text; the workbook owns the draft and evaluates only committed input. */
export function FormulaBar({scope='formula-bar',revision=0,...props}:FormulaBarProps){
 const {address,value,originalValue,onChange:_change,onCommit:_commit,onCancel:_cancel,pending=false,readOnly=false,hideActions=false,unstyled=false,disabledReason,style,...rest}=props;
 if(value.length>65536||originalValue.length>65536||address.length>512)throw new RangeError('Invalid formula buffer');
 const owner=JSON.stringify([...controlIdentity(scope,revision),address,readOnly,disabledReason]),guard=useScopedControl(owner,props,readOnly||pending||disabledReason!==undefined),off=readOnly||pending||guard.pending||disabledReason!==undefined;
 const cancelled=useRef(false);useLayoutEffect(()=>{cancelled.current=false;},[owner,value,originalValue]);
 const commit=()=>{if(cancelled.current)return;return guard.run('formula',(h,s)=>h.value!==h.originalValue?h.onCommit(h.value,s):undefined);},cancel=()=>{if(cancelled.current)return;cancelled.current=true;guard.current()?.onCancel();};
 return <View {...rest} style={[{gap:tokens.spacing.off6,minWidth:0},style]} accessibilityLabel={'Formula for '+address}>
 <View style={{flexDirection:'row',gap:tokens.spacing.off6,alignItems:'center'}}><TextInput accessibilityLabel="Formula bar" value={value} editable={!off} maxLength={65536} multiline={false} returnKeyType="done" onChangeText={v=>{cancelled.current=false;guard.current()?.onChange(v);}} onSubmitEditing={commit} onBlur={commit} onKeyPress={e=>{if(e.nativeEvent.key==='Escape')cancel();}} {...{onKeyDown:(e:{nativeEvent:{key:string};preventDefault?:()=>void})=>{if(e.nativeEvent.key==='Escape'){e.preventDefault?.();cancel();}}}} style={{minHeight:tokens.spacing.fixedTarget,flex:1,paddingHorizontal:tokens.spacing.off10}} {...{className:unstyled?undefined:'text-text border border-border rounded-control bg-surface-sunken'}}/>
 {!hideActions?<><Button title="Apply formula" disabled={off||value===originalValue} unstyled={unstyled} onPress={commit}/><Button title="Cancel formula edit" variant="secondary" disabled={off||value===originalValue} unstyled={unstyled} onPress={cancel}/></>:null}</View><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
