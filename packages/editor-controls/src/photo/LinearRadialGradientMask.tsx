import {useLayoutEffect,useMemo,useRef,type ReactNode} from 'react';
import {Image,View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {GradientOnCanvasHandles} from '../vector/GradientOnCanvasHandles.tsx';
import type {GradientPaint} from '../vector/vector-types.ts';
import {rasterToImage} from '../layers/layer-thumbnail-model.ts';
import {validatePhotoGradient,photoGradientCoverage,type PhotoGradientMask,type PhotoImageSize,type PhotoMaskCombine} from './photo-masks.ts';
export type {PhotoGradientMask,PhotoGradientGeometry} from './photo-masks.ts';
export interface LinearRadialGradientMaskProps extends Omit<ViewProps,'children'> {
 /** Photo identity and revision. Changing scope abandons an in-progress geometry edit. */
 readonly scope:string;readonly value:PhotoGradientMask;readonly imageSize:PhotoImageSize;readonly width:number;
 readonly onCommit:(mask:PhotoGradientMask)=>void;readonly onPreview?:(mask:PhotoGradientMask|undefined)=>void;
 readonly children?:ReactNode;readonly disabled?:boolean;readonly unstyled?:boolean;
}
const stops=[{offset:0,color:[0,0,0,255] as const},{offset:1,color:[255,255,255,255] as const}];
function paint(value:PhotoGradientMask):GradientPaint {const g=value.geometry;return g.type==='linear'?{...g,stops}:{type:'radial',cx:g.cx,cy:g.cy,r:g.radius,stops};}
function fromPaint(value:PhotoGradientMask,next:GradientPaint):PhotoGradientMask {return {...value,geometry:next.type==='linear'?{type:'linear',x0:next.x0,y0:next.y0,x1:next.x1,y1:next.y1}:{type:'radial',cx:next.cx,cy:next.cy,radius:next.r}};}
/** Actual bounded mask-coverage preview plus the shared native geometry handles.
 * Coordinates are source pixels; the host applies the mask to its photo. */
export function LinearRadialGradientMask({scope,value,imageSize,width,onCommit,onPreview,children,disabled=false,unstyled=false,...props}:LinearRadialGradientMaskProps){
 validatePhotoGradient(value,imageSize);if(!scope.trim()||!Number.isFinite(width)||width<120||width>4000)throw new RangeError('Gradient mask display width must be 120..4000');
 const [local,store]=useLocalStore(()=>({preview:null as PhotoGradientMask|null}));
 const boundary=JSON.stringify([scope,value,imageSize.width,imageSize.height,width,disabled]);
 const committed=useRef<string|null>(null);
 useLayoutEffect(()=>{committed.current=boundary;return()=>{committed.current=null;};},[boundary]);
 useLayoutEffect(()=>{store.set({preview:null});},[boundary,store]);
 const shown=local.preview??value;
 const scale=width/imageSize.width,height=imageSize.height*scale;
 const preview=useMemo(()=>{const factor=64/Math.max(imageSize.width,imageSize.height),w=Math.max(1,Math.round(imageSize.width*factor)),h=Math.max(1,Math.round(imageSize.height*factor)),pixels=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;pixels[i]=80;pixels[i+1]=180;pixels[i+2]=255;pixels[i+3]=Math.round(photoGradientCoverage(shown,(x+.5)/w*imageSize.width,(y+.5)/h*imageSize.height)*115);}return rasterToImage({width:w,height:h,pixels});},[shown,imageSize.width,imageSize.height]);
 const set=(change:Partial<PhotoGradientMask>)=>{if(disabled||committed.current!==boundary)return;const next={...value,...change};validatePhotoGradient(next,imageSize);onCommit(next);};
 const content=<View style={{width,height}}>{children}<Image source={{uri:preview.uri}} accessible={false} resizeMode="stretch" style={{position:'absolute',inset:0}}/></View>;
 return <View {...props} style={[{gap:8},props.style]}>
  <Select label="Photo gradient mask type" value={value.geometry.type} options={[{value:'linear',label:'Linear mask'},{value:'radial',label:'Radial mask'}]} disabled={disabled} unstyled={unstyled} onValueChange={type=>{if(type===value.geometry.type)return;set({geometry:type==='linear'?{type:'linear',x0:imageSize.width*.25,y0:imageSize.height*.5,x1:imageSize.width*.75,y1:imageSize.height*.5}:{type:'radial',cx:imageSize.width*.5,cy:imageSize.height*.5,radius:Math.max(.5,Math.min(imageSize.width,imageSize.height)*.4)}});}}/>
  <UnitInput label="Gradient mask feather" value={value.feather} min={0} max={1} step={.05} disabled={disabled} unstyled={unstyled} onCommit={feather=>set({feather})}/>
  <Select label="Gradient mask combine" value={value.combine} options={['replace','add','subtract','intersect'].map(value=>({value,label:value}))} disabled={disabled} unstyled={unstyled} onValueChange={combine=>set({combine:combine as PhotoMaskCombine})}/>
  <SettingSwitch label="Invert gradient mask" on={value.invert} onChange={invert=>set({invert})} disabled={disabled} styled={!unstyled}/>
  <GradientOnCanvasHandles scope={scope} revision={JSON.stringify(value)} disabledReason={disabled?"Gradient mask editing disabled":undefined} geometryOnly showCommands={false} paint={paint(value)} width={width} height={height} transform={[scale,0,0,scale,0,0]} selectedStop={undefined} onSelectStop={()=>{}} onPreview={next=>{if(!next){store.set({preview:null});onPreview?.(undefined);return;}if(disabled||committed.current!==boundary)return;const mask=fromPaint(value,next);try{validatePhotoGradient(mask,imageSize);}catch{onPreview?.(undefined);return;}store.set({preview:mask});onPreview?.(mask);}} onSetFill={next=>{if(committed.current!==boundary)return;const mask=fromPaint(value,next);try{validatePhotoGradient(mask,imageSize);}catch{return;}if(!disabled)onCommit(mask);}} unstyled={unstyled} label="Photo gradient mask handles">{content}</GradientOnCanvasHandles>
 </View>;
}
