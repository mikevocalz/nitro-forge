import type {ReactNode} from 'react';
import type {ViewProps} from 'react-native';
import {PhotoBrushPanel} from './PhotoBrushPanel.tsx';
import {validatePhotoBrush,type PhotoMaskBrushSettings,type PhotoBrushPoint,type PhotoImageSize} from './photo-masks.ts';
export type {PhotoMaskBrushSettings,PhotoBrushPoint,PhotoImageSize} from './photo-masks.ts';
export interface PhotoMaskStroke {readonly photoId:string;readonly expectedRevision:string;readonly imageSize:PhotoImageSize;readonly settings:PhotoMaskBrushSettings;readonly points:readonly PhotoBrushPoint[]}
export interface LocalMaskBrushProps extends Omit<ViewProps,'children'> {
 readonly photoId:string;readonly revision:string;readonly imageSize:PhotoImageSize;readonly value:PhotoMaskBrushSettings;
 readonly onChange:(settings:PhotoMaskBrushSettings)=>void;readonly onPreview?:(stroke:PhotoMaskStroke|undefined)=>void;
 readonly onStrokeCommit:(stroke:PhotoMaskStroke,signal:AbortSignal)=>void|Promise<void>;
 readonly children?:ReactNode;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Native responder-backed add/subtract marks with bounded radius, feather and force-preserving samples. */
export function LocalMaskBrush({photoId,revision,imageSize,value,onChange,onPreview,onStrokeCommit,...props}:LocalMaskBrushProps){
 validatePhotoBrush(value);if(!photoId.trim()||!['add','subtract'].includes(value.operation))throw new TypeError('Invalid mask brush identity or operation');
 const stroke=(points:readonly PhotoBrushPoint[]):PhotoMaskStroke=>({photoId,expectedRevision:revision,imageSize,settings:{...value},points});
 return <PhotoBrushPanel {...props} scope={JSON.stringify([photoId,revision])} imageSize={imageSize} value={value} label="Mask brush" tool={value.operation} tools={[{value:'add',label:'Add mask'},{value:'subtract',label:'Subtract mask'}]} onToolChange={operation=>onChange({...value,operation:operation as PhotoMaskBrushSettings['operation']})} onChange={next=>onChange({...value,...next})} onPreview={onPreview?points=>onPreview(points?stroke(points):undefined):undefined} onCommit={(points,signal)=>onStrokeCommit(stroke(points),signal)}/>;
}
