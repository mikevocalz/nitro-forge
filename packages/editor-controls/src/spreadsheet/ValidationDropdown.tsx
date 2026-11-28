import {useLayoutEffect,useRef} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface ValidationDropdownProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:string;choices:readonly {value:string;label:string}[];allowOther:boolean;allowBlank:boolean;
 validation:{status:'valid'|'invalid'|'checking';message?:string};onCommit:(value:string,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function ValidationDropdown({scope='cell-validation',revision=0,...props}:ValidationDropdownProps){
 const {value,choices,allowOther,allowBlank,validation,onCommit:_commit,unstyled=false,disabledReason,style,...rest}=props;
 if(value.length>65536||choices.length>512||new Set(choices.map(c=>c.value)).size!==choices.length||choices.some(c=>c.value.length>8192||!c.label.trim()||c.label.length>1024))throw new RangeError('Invalid validation choices');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||validation.status==='checking'),off=guard.pending||disabledReason!==undefined||validation.status==='checking';
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(value);const store=local.current,draft=useStore(store,s=>s.draft);
 useLayoutEffect(()=>{store.setState({draft:value});},[value,owner]);
 const commit=(next:string)=>guard.run('value',(h,s)=>{if(!next&&!h.allowBlank)throw new Error('A value is required');if(next&&!h.allowOther&&!h.choices.some(c=>c.value===next))throw new Error('Choose an allowed list value');return h.onCommit(next,s);});
 return <View {...rest} accessibilityLabel="Cell validation list" style={[{gap:tokens.spacing.off6},style]}><Select label="Allowed cell values" value={value} options={[...choices,...(!choices.some(c=>c.value===value)?[{value,label:value?'Current value outside list':'No value',disabled:true}]:[])]} disabled={off||choices.length===0} unstyled={unstyled} onValueChange={commit}/>
 {allowOther?<><TextInput accessibilityLabel="Custom cell value" value={draft} maxLength={65536} editable={!off} onChangeText={draft=>store.setState({draft})} onSubmitEditing={()=>commit(draft)} style={{minHeight:tokens.spacing.fixedTarget,padding:tokens.spacing.fixedElement}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/><Button title="Apply custom value" disabled={off||draft===value} unstyled={unstyled} onPress={()=>commit(draft)}/></>:null}
 {allowBlank?<Button title="Clear validated cell" variant="secondary" disabled={off||value===''} unstyled={unstyled} onPress={()=>commit('')}/>:null}<Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{validation.status}{validation.message?': '+validation.message:''}</Text><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(draft:string){return createStore(()=>({draft}));}
