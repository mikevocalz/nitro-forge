import {useRef,type ReactNode} from 'react';
import {View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {PhotoBrushSurface} from './PhotoBrushSurface.tsx';
import {validatePhotoBrush,validatePhotoBrushPoints,type PhotoBrushSettings,type PhotoBrushPoint,type PhotoImageSize} from './photo-masks.ts';
import { tokens } from '../tokens.ts';
/** Shared brush settings/input owner, specialized by LocalMaskBrush and retouch. */
export interface PhotoBrushPanelProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly imageSize:PhotoImageSize;readonly value:PhotoBrushSettings;
 readonly tool:string;readonly tools:readonly {value:string;label:string}[];readonly label:string;
 readonly onToolChange:(tool:string)=>void;readonly onChange:(settings:PhotoBrushSettings)=>void;
 readonly onCommit:(points:readonly PhotoBrushPoint[],signal:AbortSignal)=>void|Promise<void>;
 readonly onPreview?:((points:readonly PhotoBrushPoint[]|undefined)=>void)|undefined;
 readonly children?:ReactNode;readonly disabled?:boolean;readonly unstyled?:boolean;
}
const makeStore=()=>createStore(()=>({x:.5,y:.5}));
export function PhotoBrushPanel({scope,imageSize,value,tool,tools,label,onToolChange,onChange,onCommit,onPreview,children,disabled=false,unstyled=false,...props}:PhotoBrushPanelProps){
 validatePhotoBrush(value);const action=useOwnedAction(scope),locked=disabled||action.pending!==null;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,cursor=useStore(store,s=>s);
 const set=(change:Partial<PhotoBrushSettings>)=>{if(locked)return;const next={...value,...change};validatePhotoBrush(next);onChange(next);};
 const commit=(points:readonly PhotoBrushPoint[])=>{if(locked)return;validatePhotoBrushPoints(points);void action.run('stroke',signal=>onCommit(points,signal));};
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  <Select label={`${label} operation`} value={tool} options={tools} disabled={locked} unstyled={unstyled} onValueChange={tool=>{if(!locked)onToolChange(tool);}}/>
  <UnitInput label={`${label} radius pixels`} value={value.radius} min={.5} max={4096} step={1} disabled={locked} unstyled={unstyled} onCommit={radius=>set({radius})}/>
  <UnitInput label={`${label} feather`} value={value.feather} min={0} max={1} step={.05} disabled={locked} unstyled={unstyled} onCommit={feather=>set({feather})}/>
  <UnitInput label={`${label} flow`} value={value.flow} min={0} max={1} step={.05} disabled={locked} unstyled={unstyled} onCommit={flow=>set({flow})}/>
  <PhotoBrushSurface scope={JSON.stringify([scope,tool,value])} imageSize={imageSize} radiusPixels={value.radius} onCommit={commit} {...(onPreview?{onPreview}:{})} disabled={locked} unstyled={unstyled} label={`${label} drawing surface`}>{children}</PhotoBrushSurface>
  <UnitInput label={`${label} stamp x fraction`} value={cursor.x} min={0} max={1} step={.01} disabled={locked} unstyled={unstyled} onCommit={x=>store.setState({x})}/>
  <UnitInput label={`${label} stamp y fraction`} value={cursor.y} min={0} max={1} step={.01} disabled={locked} unstyled={unstyled} onCommit={y=>store.setState({y})}/>
  <Button title={`Stamp ${label.toLowerCase()}`} disabled={locked} unstyled={unstyled} onPress={()=>commit([{x:cursor.x,y:cursor.y,pressure:null}])}/>
  {action.pending!==null?<Button title={`Cancel ${label.toLowerCase()} request`} unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
