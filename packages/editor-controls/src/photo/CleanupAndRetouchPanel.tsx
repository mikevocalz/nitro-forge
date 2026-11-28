import type {ReactNode} from 'react';
import type {ViewProps} from 'react-native';
import {PhotoBrushPanel} from './PhotoBrushPanel.tsx';
import {validatePhotoBrush,type PhotoRetouchSettings,type PhotoBrushPoint,type PhotoImageSize} from './photo-masks.ts';
export type {PhotoRetouchSettings} from './photo-masks.ts';
export interface PhotoRetouchStroke {readonly photoId:string;readonly expectedRevision:string;readonly imageSize:PhotoImageSize;readonly settings:PhotoRetouchSettings;readonly points:readonly PhotoBrushPoint[]}
export interface CleanupAndRetouchPanelProps extends Omit<ViewProps,'children'> {
 readonly photoId:string;readonly revision:string;readonly imageSize:PhotoImageSize;readonly value:PhotoRetouchSettings;
 readonly onChange:(settings:PhotoRetouchSettings)=>void;readonly onPreview?:(stroke:PhotoRetouchStroke|undefined)=>void;
 readonly onStrokeCommit:(stroke:PhotoRetouchStroke,signal:AbortSignal)=>void|Promise<void>;
 readonly children?:ReactNode;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Localized heal/remove requests over an actual host photo. No cleanup algorithm is simulated here. */
export function CleanupAndRetouchPanel({photoId,revision,imageSize,value,onChange,onPreview,onStrokeCommit,...props}:CleanupAndRetouchPanelProps){
 validatePhotoBrush(value);if(!photoId.trim()||!['heal','remove'].includes(value.method))throw new TypeError('Invalid photo retouch identity or method');
 const stroke=(points:readonly PhotoBrushPoint[]):PhotoRetouchStroke=>({photoId,expectedRevision:revision,imageSize,settings:{...value},points});
 return <PhotoBrushPanel {...props} scope={JSON.stringify([photoId,revision])} imageSize={imageSize} value={value} label="Retouch brush" tool={value.method} tools={[{value:'heal',label:'Heal marks'},{value:'remove',label:'Remove spots'}]} onToolChange={method=>onChange({...value,method:method as PhotoRetouchSettings['method']})} onChange={next=>onChange({...value,...next})} onPreview={onPreview?points=>onPreview(points?stroke(points):undefined):undefined} onCommit={(points,signal)=>onStrokeCommit(stroke(points),signal)}/>;
}
