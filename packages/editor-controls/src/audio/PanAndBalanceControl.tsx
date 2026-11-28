import {View} from 'react-native';
import {PanControl,type PanControlProps} from './PanControl.tsx';
import {SurroundPanView,type SurroundPanViewProps} from './SurroundPanView.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface StereoPanAndBalanceProps extends Omit<PanControlProps,'onCommit'>,ScopedControlProps {onCommit:(pan:number,signal?:AbortSignal)=>void|Promise<unknown>}
export type PanAndBalanceControlProps=StereoPanAndBalanceProps|({mode:'surround';surround:SurroundPanViewProps}&ScopedControlProps);
export function PanAndBalanceControl(props:PanAndBalanceControlProps){return props.mode==='surround'?<SurroundPanView {...props.surround} {...(props.scope?{scope:props.scope}:{})} {...(props.revision===undefined?{}:{revision:props.revision})} {...(props.disabledReason?{disabledReason:props.disabledReason}:{})}/>:<StereoPan {...props}/>;}
function StereoPan({scope='pan-balance',revision=0,...props}:StereoPanAndBalanceProps){
 const {disabledReason,...control}=props,owner=JSON.stringify([...controlIdentity(scope,revision),props.mode,props.width,props.disabled,disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||disabledReason!==undefined);
 return <View style={{gap:tokens.spacing.fixedStack,minWidth:0}}><PanControl key={owner} {...control} disabled={!!props.disabled||disabledReason!==undefined||guard.pending} onChange={value=>guard.current()?.onChange?.(value)} onCommit={value=>guard.run('pan',(host,signal)=>host.onCommit(value,signal))}/><ErrorMessage {...exact({message:guard.error??undefined,unstyled:props.unstyled})}/></View>;
}
