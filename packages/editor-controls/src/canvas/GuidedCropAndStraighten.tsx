import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {ImageCropOverlay} from '../graphics/ImageCropOverlay.tsx';
import {fitCropAspect,validateCrop,type CropRect} from '../graphics/crop.ts';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface GuidedCropValue {readonly rect:CropRect;readonly angle:number;readonly ratio:'free'|'original'|'1:1'|'4:3'|'3:2'|'16:9'}
export interface GuidedCropAndStraightenProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:GuidedCropValue;imageWidth:number;imageHeight:number;width:number;height:number;
 onPreview?:(value:GuidedCropValue|undefined)=>void;
 onCommit:(value:GuidedCropValue,signal?:AbortSignal)=>void|Promise<unknown>;
 /** Render the image in the host's existing renderer using the requested angle. */
 children:ReactNode;grid?:'thirds'|'center'|'none';onGridChange?:(grid:'thirds'|'center'|'none')=>void;
 unstyled?:boolean;
}
const RATIOS=[{value:'free',label:'Free'},{value:'original',label:'Original'},{value:'1:1',label:'Square'},{value:'4:3',label:'4:3'},{value:'3:2',label:'3:2'},{value:'16:9',label:'16:9'}] as const;
/** Controlled crop geometry and straightening. The host owns pixels, rotation and undo. */
export function GuidedCropAndStraighten({scope='guided-crop',revision=0,...props}:GuidedCropAndStraightenProps){
 const {value,imageWidth,imageHeight,width,height,children,grid='thirds',onGridChange,unstyled=false,style,...rest}=props;
 validateCrop(value.rect);
 if(![imageWidth,imageHeight,width,height].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(value.angle)||value.angle< -180||value.angle>180||!RATIOS.some(r=>r.value===value.ratio))throw new RangeError('Invalid guided crop');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,imageWidth,imageHeight,width,height,value.ratio]);
 const guard=useScopedControl(owner,props,props.disabledReason!==undefined),off=guard.pending||props.disabledReason!==undefined;
 const commit=(next:GuidedCropValue)=>guard.run('crop',(host,signal)=>host.onCommit(next,signal));
 const ratio=(name:GuidedCropValue['ratio'])=>name==='free'?undefined:name==='original'?1:Number(name.split(':')[0])/Number(name.split(':')[1])*imageHeight/imageWidth;
 const aspect=ratio(value.ratio);
 const angle=(n:number)=>((n+180)%360+360)%360-180;
 // Forward View props only; host operations and image dimensions are not native attributes.
 const {onCommit:_commit,onPreview:_preview,disabledReason,...viewProps}=rest;
 return <View {...viewProps} style={[{minWidth:0,gap:8},style]} accessibilityLabel="Crop and straighten">
  <ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
  {off?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Applying crop'}</Text>:null}
  <SegmentedControl aria-label="Crop ratio" disabled={off} options={RATIOS} value={value.ratio} unstyled={unstyled} onChange={name=>{const r=ratio(name);void commit({...value,ratio:name,rect:r===undefined?value.rect:fitCropAspect(value.rect,r)});}}/>
  <ImageCropOverlay key={owner} scope={scope} revision={revision} disabled={off} rect={value.rect} width={width} height={height} grid={grid} {...(aspect===undefined?{}:{aspectRatio:aspect})} unstyled={unstyled}
   onPreview={rect=>guard.current()?.onPreview?.({...value,rect})} onCommit={rect=>commit({...value,rect})}>{children}</ImageCropOverlay>
  <PrecisionScrubber scope={scope} revision={revision} label="Straighten" unit="°" min={-180} max={180} step={0.1} value={value.angle} disabled={off} unstyled={unstyled}
   onPreview={degrees=>guard.current()?.onPreview?.({...value,angle:degrees})} onCommit={degrees=>commit({...value,angle:degrees})}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
   <Button title="Rotate left" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>commit({...value,angle:angle(value.angle-90)})}/>
   <Button title="Rotate right" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>commit({...value,angle:angle(value.angle+90)})}/>
   <Button title="Reset crop" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>commit({rect:{x:0,y:0,width:1,height:1},angle:0,ratio:'free'})}/>
  </View>
  {onGridChange?<SegmentedControl aria-label="Crop guides" disabled={off} value={grid} options={[{value:'thirds',label:'Thirds'},{value:'center',label:'Centre'},{value:'none',label:'None'}]} unstyled={unstyled} onChange={next=>{if(guard.current())onGridChange(next);}}/>:null}
 </View>;
}
