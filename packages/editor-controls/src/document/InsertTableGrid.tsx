import {useRef} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture,useTapGesture,useCompetingGestures} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface InsertTableGridProps extends Omit<ViewProps,'children'>,ScopedControlProps {maxRows?:number;maxColumns?:number;onInsert:(rows:number,columns:number,signal?:AbortSignal)=>unknown;unstyled?:boolean}
/** Native touch selection plus numeric insertion for larger tables and keyboard/accessibility use. */
export function InsertTableGrid({scope='insert-table',revision=0,...props}:InsertTableGridProps){
 const {maxRows=1000,maxColumns=100,onInsert:_insert,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isInteger(maxRows)||maxRows<1||maxRows>10000||!Number.isInteger(maxColumns)||maxColumns<1||maxColumns>1000)throw new RangeError('Invalid table insertion limits');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),maxRows,maxColumns,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),active=useRef<string|null>(null),startWidth=useRef(0),rows=Math.min(6,maxRows),columns=Math.min(8,maxColumns),width=store.getState().width;
 const select=(x:number,y:number)=>{if(!guard.current()||width<=0)return;store.setState({rows:Math.max(1,Math.min(rows,Math.floor(y/44)+1)),columns:Math.max(1,Math.min(columns,Math.floor(x/(width/columns))+1))});};
 const insert=()=>guard.run('insert',(h,signal)=>{const v=store.getState();if(v.rows>(h.maxRows??1000)||v.columns>(h.maxColumns??100))throw new Error('Table size is no longer available');return h.onInsert(v.rows,v.columns,signal);});
 const pan=usePanGesture({enabled:!off,runOnJS:true,minDistance:5,maxPointers:1,onActivate:e=>{active.current=owner;startWidth.current=store.getState().width;select(e.x,e.y);},onUpdate:e=>{if(active.current===owner&&startWidth.current===store.getState().width)select(e.x,e.y);},onDeactivate:e=>{const valid=active.current===owner&&startWidth.current===store.getState().width;active.current=null;if(valid&&!e.canceled){select(e.x,e.y);void insert();}},onFinalize:()=>{active.current=null;}});
 const tap=useTapGesture({enabled:!off,runOnJS:true,maxDuration:300,maxDistance:5,onActivate:e=>{select(e.x,e.y);void insert();}}),gesture=useCompetingGestures(pan,tap);
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Insert table">
  <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{s.rows} rows by {s.columns} columns</Text>
  <GestureDetector key={owner} gesture={gesture} touchAction="none"><View collapsable={false} onLayout={e=>store.setState({width:e.nativeEvent.layout.width})} accessible={false} style={{height:rows*tokens.spacing.fixedTarget}}>{Array.from({length:rows},(_,r)=><View key={r} style={{flexDirection:'row',height:tokens.spacing.fixedTarget}}>{Array.from({length:columns},(_,c)=><View key={c} pointerEvents="none" {...{className:unstyled?undefined:`border border-border ${r<s.rows&&c<s.columns?'bg-accent/20':'bg-surface-raised'}`}} style={{flex:1}}/>)}</View>)}</View></GestureDetector>
  <PropertyInspector scope={owner} label="Table dimensions" unstyled={unstyled} disabledReason={off?'Table insertion unavailable':undefined} fields={[...(maxRows>1?[{id:'rows',kind:'number' as const,label:'Rows',value:Math.min(s.rows,maxRows),min:1,max:maxRows,step:1}]:[]),...(maxColumns>1?[{id:'columns',kind:'number' as const,label:'Columns',value:Math.min(s.columns,maxColumns),min:1,max:maxColumns,step:1}]:[])]} onCommit={(id,value)=>{if(typeof value==='number')store.setState({[id]:Math.round(value)});}}/>
  <Button title="Insert selected table" disabled={off||s.rows>maxRows||s.columns>maxColumns} unstyled={unstyled} onPress={insert}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
function makeStore(){return createStore(()=>({rows:1,columns:1,width:0}));}
