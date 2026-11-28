import {useRef,useLayoutEffect} from 'react';
import {createCoordinateAdmission,createMeasuredCoordinateOwner} from '@nyc-tron/ui/components/gestures/coordinate-admission';
import {View,Text,type ViewProps} from 'react-native';
import {GestureDetector,usePanGesture} from 'react-native-gesture-handler';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
export interface ParagraphRulerValue {leftIndent:number;rightIndent:number;firstLine:number;columns:number;columnGap:number;tabs:readonly {id:string;position:number;alignment:'left'|'right'|'center'|'decimal'}[]}
export interface ParagraphRulerProps extends Omit<ViewProps,'children'>,ScopedControlProps {textWidth:number;value:ParagraphRulerValue;onCommit:(value:ParagraphRulerValue,signal?:AbortSignal)=>unknown;onAddTab:(signal?:AbortSignal)=>unknown;unstyled?:boolean}
function validate(value:ParagraphRulerValue,width:number){if(!Number.isFinite(width)||width<=0||width>14400||![value.leftIndent,value.rightIndent,value.firstLine,value.columnGap].every(Number.isFinite)||value.leftIndent<0||value.rightIndent<0||value.leftIndent+value.rightIndent>=width||value.firstLine< -value.leftIndent||value.firstLine>width-value.leftIndent-value.rightIndent||!Number.isInteger(value.columns)||value.columns<1||value.columns>32||value.columnGap<0||(value.columns-1)*value.columnGap>=width-value.leftIndent-value.rightIndent||value.tabs.length>64||new Set(value.tabs.map(t=>t.id)).size!==value.tabs.length||value.tabs.some(t=>!t.id.trim()||t.id.length>256||!Number.isFinite(t.position)||t.position<0||t.position>width||!['left','right','center','decimal'].includes(t.alignment)))throw new RangeError('Invalid paragraph ruler');}
export function ParagraphRuler({scope='paragraph-ruler',revision=0,...props}:ParagraphRulerProps){
 const {textWidth,value,onCommit:_commit,onAddTab:_add,unstyled=false,disabledReason,style,...rest}=props;validate(value,textWidth);
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),textWidth,value,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,width=useStore(store,s=>s.width);
 const measurementBoundary=useEditorBoundary([scope,revision]);
 const measurement=useRef<ReturnType<typeof createMeasuredCoordinateOwner>|null>(null);measurement.current??=createMeasuredCoordinateOwner();
 useLayoutEffect(()=>{measurement.current!.admit(measurementBoundary);return()=>measurement.current!.invalidate(measurementBoundary);},[measurementBoundary]);
 const commit=(next:ParagraphRulerValue)=>guard.run('ruler',(h,s)=>{validate(next,h.textWidth);return h.onCommit(next,s);});
 const patch=(id:string,v:unknown)=>commit({...value,[id]:v});
 return <View {...rest} accessibilityLabel="Paragraph ruler" style={[{gap:8,minWidth:0},style]}>
  <View style={{height:176,position:'relative',direction:'ltr'}} onLayout={e=>{const next=measurement.current!.measure(measurementBoundary,e.nativeEvent.layout.width);if(next!==undefined)store.setState({width:next});}}>
   <View pointerEvents="none" {...{className:unstyled?undefined:'border-b border-border'}} style={{position:'absolute',left:0,right:0,top:32}}/>
   {Array.from({length:11},(_,i)=><Text key={i} pointerEvents="none" {...{className:unstyled?undefined:'text-text-muted'}} style={{position:'absolute',left:i/10*Math.max(0,width-32),top:0}}>{Math.round(i/10*textWidth)}</Text>)}
   {([{id:'leftIndent',label:'Left indent',position:value.leftIndent},{id:'rightIndent',label:'Right indent',position:textWidth-value.rightIndent},{id:'firstLine',label:'First line indent',position:value.leftIndent+value.firstLine}] as const).map((m,index)=><RulerHandle row={index} key={m.id} boundary={owner} id={m.id} label={m.label} position={m.position} textWidth={textWidth} width={width} disabled={off} unstyled={unstyled} onCommit={n=>patch(m.id,m.id==='rightIndent'?textWidth-n:m.id==='firstLine'?n-value.leftIndent:n)}/>)}
  </View>
  <PropertyInspector scope={owner} label="Indents and columns" disabledReason={off?'Ruler editing unavailable':undefined} unstyled={unstyled} fields={[
   ...(['leftIndent','rightIndent','firstLine','columnGap'] as const).map(id=>({id,label:{leftIndent:'Left indent',rightIndent:'Right indent',firstLine:'First-line offset',columnGap:'Column gap'}[id],kind:'number' as const,value:value[id],min:id==='firstLine'?-textWidth:0,max:textWidth,step:.5,unit:'pt'})),{id:'columns',label:'Columns',kind:'number',value:value.columns,min:1,max:32,step:1}
  ]} onCommit={(id,v)=>patch(id,v)}/>
  {value.tabs.map(t=><View key={t.id} style={{gap:6}}><PropertyInspector scope={owner+':'+t.id} label={'Tab '+t.id} unstyled={unstyled} disabledReason={off?'Tab editing unavailable':undefined} fields={[{id:'position',label:'Tab stop position',kind:'number',value:t.position,min:0,max:textWidth,step:.5,unit:'pt'},{id:'alignment',label:'Tab alignment',kind:'choice',value:t.alignment,choices:['left','right','center','decimal'].map(id=>({id,label:id}))}]} onCommit={(id,v)=>commit({...value,tabs:value.tabs.map(old=>old.id===t.id?{...old,[id]:v}:old)})}/><Button title="Remove tab stop" disabled={off} unstyled={unstyled} onPress={()=>commit({...value,tabs:value.tabs.filter(old=>old.id!==t.id)})}/></View>)}
  <Button title="Add tab stop" disabled={off||value.tabs.length>=64} unstyled={unstyled} onPress={()=>guard.run('add-tab',(h,s)=>h.onAddTab(s))}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
function RulerHandle({boundary,label,position,textWidth,width,disabled,unstyled,onCommit,row}:{boundary:string;id:string;label:string;position:number;textWidth:number;width:number;disabled:boolean;unstyled:boolean;onCommit:(n:number)=>unknown;row:number}){
 const local=useRef<ReturnType<typeof makeHandleStore>|null>(null);local.current??=makeHandleStore();const store=local.current,preview=useStore(store,s=>s.preview),shown=preview??position;
 const admission=useRef<ReturnType<typeof createCoordinateAdmission>|null>(null);admission.current??=createCoordinateAdmission();const gate=admission.current;
 const coordinates=useEditorBoundary([boundary,width,disabled]);
 const start=useRef<number|null>(null);
 useLayoutEffect(()=>{gate.admit(coordinates);start.current=null;store.setState({preview:null});return()=>gate.invalidate(coordinates);},[coordinates,gate,store]);
 const ready=()=>!disabled&&width>44&&gate.ready(coordinates);
 const next=(dx:number)=>Math.round(Math.min(textWidth,Math.max(0,(start.current??position)+dx/(width-44)*textWidth))*2)/2;
 const clear=()=>{gate.cancel();start.current=null;store.setState({preview:null});};
 const pan=usePanGesture({enabled:!disabled&&width>44,runOnJS:true,maxPointers:1,activeOffsetX:[-4,4],failOffsetY:[-8,8],
  onActivate:()=>{if(ready()&&gate.begin(coordinates))start.current=position;},
  onUpdate:e=>{if(ready()&&gate.current(coordinates)&&start.current!==null)store.setState({preview:next(e.translationX)});},
  onDeactivate:e=>{if(!ready()||!gate.current(coordinates))return;const value=next(e.translationX),valid=gate.finish(coordinates);start.current=null;store.setState({preview:null});if(valid&&!e.canceled)void onCommit(value);},
  onFinalize:()=>{if(gate.ready(coordinates))clear();},
 });
 return <GestureDetector gesture={pan} touchAction="pan-y"><View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{min:0,max:textWidth,now:shown}} accessibilityState={{disabled}} accessibilityActions={[{name:'increment'},{name:'decrement'}]} onAccessibilityAction={e=>{if(!ready())return;const d=e.nativeEvent.actionName==='increment'?1:e.nativeEvent.actionName==='decrement'?-1:0;if(d)void onCommit(Math.min(textWidth,Math.max(0,position+d)));}} style={{position:'absolute',left:Math.max(0,Math.min(width-44,shown/textWidth*(width-44))),top:28+row*48,width:44,height:44,alignItems:'center',justifyContent:'center'}}><View pointerEvents="none" {...{className:unstyled?undefined:'bg-accent'}} style={{width:8,height:20}}/></View></GestureDetector>;
}
function makeStore(){return createStore(()=>({width:0}));}

function makeHandleStore(){return createStore(()=>({preview:null as number|null}));}
