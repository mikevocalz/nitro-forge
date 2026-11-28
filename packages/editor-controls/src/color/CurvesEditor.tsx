import {forgeRadius} from "../radius.ts";
import {useEffect,useLayoutEffect,useRef,type ComponentRef} from "react";
import {Platform,Text,View,type ViewProps} from "react-native";
import {createStore,type StoreApi} from "zustand/vanilla";
import {useStore} from "zustand";
import {Select} from "@nyc-tron/ui/components/Select";
import {Button} from "@nyc-tron/ui/components/Button";
import {UnitInput} from "@nyc-tron/ui/components/shell/UnitInput";
import {PanResponderDrag} from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import type {DragTransport,DragPoint} from "@nyc-tron/ui/components/gestures/drag-transport";
import {keyboardKey} from "@nyc-tron/ui/components/gestures/drag-transport";
import {LinePiece} from "../vector/vector-controls.tsx";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {bounded,validateCurve,moveCurvePoint,evaluateCurve,type ColorCurve} from "./color-adjustments.ts";
import { tokens } from "../tokens.ts";
export type {ColorCurve,CurvePoint} from "./color-adjustments.ts";
/** One controlled channel curve and its document revision boundary. */
export interface CurvesEditorProps extends Omit<ViewProps,"children">{
 readonly scope:string;
 readonly value:ColorCurve;
 readonly selectedId:string;
 readonly onSelect:(id:string)=>void;
 readonly onPreview?:(value:ColorCurve|undefined)=>void;
 readonly onCommit:(value:ColorCurve,selectedId:string)=>void;
 /** Stable IDs are allocated by the host, not inferred from point coordinates. */
 readonly createPointId:()=>string;
 /** Application-specific curve presets; an identity reset is always available. */
 readonly presets?:readonly {readonly id:string;readonly label:string;readonly curve:ColorCurve}[];
 /** Optional multi-channel selector; all three fields are required together. */
 readonly channelSelection?:{readonly channels:readonly {readonly id:string;readonly label:string}[];readonly value:string;readonly onChange:(id:string)=>void};
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
 /** Native consumers with GestureHandlerRootView can supply GestureHandlerDrag. */
 readonly transport?:DragTransport;
}
type Geometry={x:number;y:number;width:number;height:number};
type Local={width:number;preview:ColorCurve|null};
/** Editable normalized transfer curve with pointer preview, single release commit and keyboard/numeric alternatives. */
export function CurvesEditor({scope,value,selectedId,onSelect,onPreview,onCommit,createPointId,presets=[],channelSelection,height=200,disabled=false,unstyled=false,transport:Transport=PanResponderDrag,...props}:CurvesEditorProps){
 validateCurve(value);
 if(presets.length>128||new Set(presets.map(p=>p.id)).size!==presets.length||presets.some(p=>!p.id||!p.label))throw new TypeError('Curve presets require at most 128 distinct labeled IDs');presets.forEach(p=>validateCurve(p.curve));
 if(channelSelection&&(!channelSelection.channels.some(c=>c.id===channelSelection.value)||new Set(channelSelection.channels.map(c=>c.id)).size!==channelSelection.channels.length||channelSelection.channels.length>16))throw new TypeError('Choose a distinct available curve channel');
 bounded(height,88,600,'Curve height');
 const selected=value.points.find(p=>p.id===selectedId);if(!selected)throw new TypeError('Selected curve point is unavailable');
 const local=useRef<StoreApi<Local>|null>(null);local.current??=createStore<Local>(()=>({width:0,preview:null}));const store=local.current,state=useStore(store,s=>s);
 const root=useRef<ComponentRef<typeof View>|null>(null),geometry=useRef<Geometry|null>(null);
 const drag=useRef<{scope:string;start:ColorCurve;id:string;next:ColorCurve}|null>(null);
 const callbacks=useRef({onPreview,onCommit});callbacks.current={onPreview,onCommit};
 const pending=useRef<{scope:string;start:DragPoint;latest:DragPoint}|null>(null);
 const cancel=()=>{pending.current=null;if(!drag.current)return;drag.current=null;store.setState({preview:null});callbacks.current.onPreview?.(undefined);};
 useLayoutEffect(()=>{cancel();return cancel;},[scope,disabled]);
 useEffect(()=>()=>cancel(),[]);
 const measure=()=>{root.current?.measureInWindow((x,y,width,measuredHeight)=>{if([x,y,width,measuredHeight].every(Number.isFinite)&&width>44&&measuredHeight>44){geometry.current={x,y,width,height:measuredHeight};store.setState({width});}});};
 const adjust=(point:DragPoint)=>{
  const current=drag.current,g=geometry.current;if(!current||!g||disabled||current.scope!==scope)return;
  const x=Math.max(0,Math.min(1,(point.x-g.x-22)/(g.width-44))),y=Math.max(0,Math.min(1,1-(point.y-g.y-22)/(g.height-44)));
  current.next=moveCurvePoint(current.start,current.id,x,y);store.setState({preview:current.next});onPreview?.(current.next);
 };
 const begin=(point:DragPoint)=>{
  if(disabled)return;
  const request={scope,start:point,latest:point};pending.current=request;
  root.current?.measureInWindow((x,y,width,measuredHeight)=>{
   if(pending.current!==request)return;
   pending.current=null;
   if(![x,y,width,measuredHeight].every(Number.isFinite)||width<=44||measuredHeight<=44)return;
   const g={x,y,width,height:measuredHeight};geometry.current=g;store.setState({width});
   const ordered=value.points.map(p=>({p,d:Math.hypot(g.x+22+p.x*(g.width-44)-request.start.x,g.y+22+(1-p.y)*(g.height-44)-request.start.y)})).sort((a,b)=>a.d-b.d);
   const hit=ordered[0];if(!hit||hit.d>44)return;onSelect(hit.p.id);drag.current={scope,start:value,id:hit.p.id,next:value};adjust(request.latest);
  });
 };
 const commitPoint=(x:number,y:number)=>{if(disabled)return;onCommit(moveCurvePoint(value,selectedId,x,y),selectedId);};
 const keyDown=(event:unknown)=>{const key=keyboardKey(event as Parameters<typeof keyboardKey>[0]);if(key==='Escape'){cancel();return;}if(disabled)return;const d=.01;let x=selected.x,y=selected.y;if(key==='ArrowLeft')x-=d;else if(key==='ArrowRight')x+=d;else if(key==='ArrowUp')y+=d;else if(key==='ArrowDown')y-=d;else return;(event as {preventDefault?:()=>void}).preventDefault?.();commitPoint(Math.max(0,Math.min(1,x)),Math.max(0,Math.min(1,y)));};
 const shown=state.preview??value,width=Math.max(88,state.width||240),w=width-44,h=height-44;
 const samples=Array.from({length:129},(_,i)=>({x:22+i/128*w,y:22+(1-evaluateCurve(shown,i/128))*h}));
 const index=value.points.indexOf(selected),canRemove=index>0&&index<value.points.length-1;
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  {channelSelection?<Select label="Curve channel" value={channelSelection.value} options={channelSelection.channels.map(c=>({value:c.id,label:c.label}))} disabled={disabled} unstyled={unstyled} onValueChange={channelSelection.onChange}/>:null}
  {presets.length?<Select label="Curve preset" value="" placeholder="Apply a curve preset" options={presets.map(p=>({value:p.id,label:p.label}))} disabled={disabled} unstyled={unstyled} onValueChange={id=>{const preset=presets.find(p=>p.id===id);if(!disabled&&preset)onCommit(preset.curve,preset.curve.points[0]!.id);}}/>:null}
  <Button title="Reset curve to identity" disabled={disabled} unstyled={unstyled} onPress={()=>{if(!disabled){const points=[{...value.points[0]!,x:0,y:0},{...value.points.at(-1)!,x:1,y:1}];onCommit({...value,points},points[0]!.id);}}}/>
  <Select label="Curve interpolation" value={value.interpolation} options={[{value:'linear',label:'Linear'},{value:'monotone',label:'Monotone cubic'}]} disabled={disabled} unstyled={unstyled} onValueChange={interpolation=>{if(!disabled)onCommit({...value,interpolation:interpolation as ColorCurve['interpolation']},selectedId);}}/>
  <Select label="Curve control point" value={selectedId} options={value.points.map((p,i)=>({value:p.id,label:`Point ${i+1}: input ${p.x.toFixed(3)}, output ${p.y.toFixed(3)}`}))} disabled={disabled} unstyled={unstyled} onValueChange={onSelect}/>
  <Transport disabled={disabled} onBegin={begin} onMove={(point,touches)=>{if(touches!==1){cancel();return;}if(pending.current)pending.current.latest=point;else adjust(point);}} onCancel={cancel} onRelease={point=>{
   pending.current=null;adjust(point);const current=drag.current;drag.current=null;store.setState({preview:null});onPreview?.(undefined);if(!disabled&&current&&current.scope===scope&&current.next.points.some((p,i)=>p.x!==current.start.points[i]!.x||p.y!==current.start.points[i]!.y))onCommit(current.next,current.id);
  }}><View ref={root} collapsable={false} onLayout={measure} accessible accessibilityRole="adjustable" accessibilityLabel="Curve point output" aria-valuemin={0} aria-valuemax={1} aria-valuenow={selected.y} aria-valuetext={`Input ${selected.x}, output ${selected.y}`} aria-disabled={disabled}
   accessibilityActions={[{name:'increment',label:'Increase output'},{name:'decrement',label:'Decrease output'}]} onAccessibilityAction={e=>{if(e.nativeEvent.actionName==='increment')commitPoint(selected.x,Math.min(1,selected.y+.01));if(e.nativeEvent.actionName==='decrement')commitPoint(selected.x,Math.max(0,selected.y-.01));}}
   {...{focusable:!disabled,onKeyDown:keyDown,onPointerEnter:measure,className:joinClasses(!unstyled&&'border border-border rounded-control bg-surface-sunken focus-visible:ring-2 focus-visible:ring-focus')}}
   style={{height,overflow:'hidden',...(Platform.OS==='web'?{userSelect:'none',touchAction:'none'}:{})} as object}>
   <View pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden style={{position:'absolute',inset:0}}>
    <LinePiece from={{x:22,y:height-22}} to={{x:width-22,y:22}} className={joinClasses(!unstyled&&'bg-border')}/>
    {samples.slice(1).map((point,i)=><LinePiece key={i} from={samples[i]!} to={point} className={joinClasses(!unstyled&&'bg-primary')}/>)}
    {shown.points.map(p=><View key={p.id} {...{className:joinClasses(!unstyled&&(p.id===selectedId?'bg-primary border-text':'bg-surface-raised border-primary'))}} style={{position:'absolute',left:tokens.spacing.off22+p.x*w-tokens.spacing.off6,top:tokens.spacing.off22+(tokens.borderWidth.hairline-p.y)*h-tokens.spacing.off6,width:tokens.spacing.fixedInset,height:tokens.spacing.fixedInset,borderRadius:forgeRadius.sm,borderWidth:tokens.borderWidth.strong}}/>)}
   </View>
  </View></Transport>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}><UnitInput label="Curve input" value={selected.x} min={0} max={1} step={.01} precision={6} disabled={disabled||!canRemove} unstyled={unstyled} onCommit={x=>commitPoint(x,selected.y)}/><UnitInput label="Curve output" value={selected.y} min={0} max={1} step={.01} precision={6} disabled={disabled} unstyled={unstyled} onCommit={y=>commitPoint(selected.x,y)}/></View>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}><Button title="Add curve point" disabled={disabled||value.points.length>=64} unstyled={unstyled} onPress={()=>{
   if(disabled||value.points.length>=64)return;let gap=0;for(let i=1;i<value.points.length-1;i++)if(value.points[i+1]!.x-value.points[i]!.x>value.points[gap+1]!.x-value.points[gap]!.x)gap=i;
   const x=(value.points[gap]!.x+value.points[gap+1]!.x)/2,id=createPointId();const next={...value,points:[...value.points.slice(0,gap+1),{id,x,y:evaluateCurve(value,x)},...value.points.slice(gap+1)]};validateCurve(next);onCommit(next,id);
  }}/><Button title="Remove curve point" disabled={disabled||!canRemove} unstyled={unstyled} onPress={()=>{if(!disabled&&canRemove)onCommit({...value,points:value.points.filter(p=>p.id!==selectedId)},value.points[index-1]!.id);}}/></View>
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Drag a point; arrows adjust the selected point. Escape cancels. Input runs left to right in every locale.</Text>
 </View>;
}
