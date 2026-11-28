import {useLayoutEffect,useRef} from 'react';
import {View,TextInput,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {parseA1Range} from './chart-model.ts';
import type {SheetRange} from '../sheet-window.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface NameBoxProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 selectionLabel:string;rowCount:number;columnCount:number;names:readonly {id:string;label:string;range:SheetRange}[];
 onNavigate:(range:SheetRange,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function NameBox({scope='name-box',revision=0,...props}:NameBoxProps){
 const {selectionLabel,rowCount,columnCount,names,onNavigate:_navigate,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(rowCount)||rowCount<0||!Number.isSafeInteger(columnCount)||columnCount<0||names.length>1024||selectionLabel.length>512)throw new RangeError('Invalid name box');
 const owner=JSON.stringify([...controlIdentity(scope,revision),rowCount,columnCount,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(selectionLabel);const store=local.current,draft=useStore(store,s=>s.draft);
 useLayoutEffect(()=>{store.setState({draft:selectionLabel});},[selectionLabel,owner]);
 const go=(text=draft)=>guard.run('navigate',(h,s)=>{const named=h.names.find(n=>n.id===text||n.label.toLocaleLowerCase()===text.toLocaleLowerCase()),range=named?.range??parseA1Range(text);if(!range||![range.startRow,range.endRow,range.startColumn,range.endColumn].every(Number.isSafeInteger)||range.endRow<range.startRow||range.endColumn<range.startColumn||range.startRow<0||range.startColumn<0||range.endRow>=h.rowCount||range.endColumn>=h.columnCount)throw new Error('Enter an address or named range within this sheet');return h.onNavigate(range,s);});
 return <View {...rest} style={[{gap:tokens.spacing.off6,minWidth:0},style]} accessibilityLabel="Cell address and named ranges"><View style={{flexDirection:'row',gap:tokens.spacing.off6}}><TextInput accessibilityLabel="Cell address or range name" value={draft} maxLength={512} editable={!off} onChangeText={draft=>store.setState({draft})} onSubmitEditing={()=>go()} style={{minHeight:tokens.spacing.fixedTarget,minWidth:tokens.spacing.fixedRail,flex:1,padding:tokens.spacing.fixedElement}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/><Button title="Go to range" disabled={off} unstyled={unstyled} onPress={()=>go()}/></View>{names.length?<Select label="Named ranges" value="none" options={[{value:'none',label:'Choose a named range',disabled:true},...names.map(n=>({value:n.id,label:n.label}))]} disabled={off} unstyled={unstyled} onValueChange={id=>go(id)}/>:null}<ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(draft:string){return createStore(()=>({draft}));}
