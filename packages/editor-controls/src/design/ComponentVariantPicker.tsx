import {View,type ViewProps} from 'react-native';
import {PropertyInspector,type InspectorProperty} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface ComponentVariantPickerProps extends Omit<ViewProps,'children'>,ScopedControlProps {componentId:string;properties:readonly Extract<InspectorProperty,{kind:'choice'}>[];overrides:readonly InspectorProperty[];onPropertyChange:(id:string,value:string,signal?:AbortSignal)=>unknown;onOverride:(id:string,value:string|number|boolean,signal?:AbortSignal)=>unknown;onReset:(signal?:AbortSignal)=>unknown;unstyled?:boolean}
export function ComponentVariantPicker({scope='component-variant',revision=0,...props}:ComponentVariantPickerProps){
 const {componentId,properties,overrides,onPropertyChange:_property,onOverride:_override,onReset:_reset,unstyled=false,disabledReason,style,...rest}=props;if(!componentId.trim())throw new RangeError('Component identity is required');
 const owner=JSON.stringify([...controlIdentity(scope,revision),componentId,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]}><PropertyInspector scope={scope} revision={revision} label="Component variant properties" fields={properties} disabledReason={off?'Component variant unavailable':undefined} unstyled={unstyled} onCommit={(id,v)=>guard.run('property',(h,s)=>h.onPropertyChange(id,String(v),s))}/><PropertyInspector scope={scope} revision={revision} label="Instance overrides" fields={overrides} disabledReason={off?'Instance overrides unavailable':undefined} unstyled={unstyled} onCommit={(id,v)=>guard.run('override',(h,s)=>h.onOverride(id,v,s))}/><Button title="Reset instance overrides" disabled={off||!overrides.length} unstyled={unstyled} onPress={()=>guard.run('reset',(h,s)=>h.onReset(s))}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
