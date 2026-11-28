import type {ReactNode} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {InkAndLaserPointer,type InkAndLaserPointerProps} from '../slides/InkAndLaserPointer.tsx';
import {PointEditor2D,type EditorPoint2D} from '../inputs/PointEditor2D.tsx';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface PDFSignatureArtifact {id:string;kind:'ink'|'image';label:string;aspectRatio:number}
export interface SignatureStampToolProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 mode:'ink'|'image';ink:Omit<InkAndLaserPointerProps,'capture'|'onCaptureStroke'>;
 artifact:PDFSignatureArtifact|null;placement:{pageId:string;x:number;y:number;width:number;rotation:number};
 canPlace:boolean;placedArtifactId?:string;onModeChange:(mode:'ink'|'image')=>void;
 onChooseImage:(signal?:AbortSignal)=>unknown;onCreateInkArtifact:(signal?:AbortSignal)=>unknown;
 onPlacementChange:(placement:SignatureStampToolProps['placement'],signal?:AbortSignal)=>unknown;
 onPlace:(artifactId:string,placement:SignatureStampToolProps['placement'],signal?:AbortSignal)=>unknown;
 renderPlacement:(artifact:PDFSignatureArtifact|null,placement:SignatureStampToolProps['placement'])=>ReactNode;unstyled?:boolean;
}
/** Visible signature stamp authoring. Certificate signing is a separate native PDF form workflow. */
export function SignatureStampTool({scope='pdf-signature',revision=0,...props}:SignatureStampToolProps){
 const {mode,ink,artifact,placement,canPlace,placedArtifactId,onModeChange:_mode,onChooseImage:_image,onCreateInkArtifact:_create,onPlacementChange:_placement,onPlace:_place,renderPlacement,unstyled=false,disabledReason,style,...rest}=props;
 if(!['ink','image'].includes(mode)||!placement.pageId.trim()||![placement.x,placement.y,placement.width,placement.rotation].every(Number.isFinite)||placement.x<0||placement.x>1||placement.y<0||placement.y>1||placement.width<.001||placement.width>1||placement.rotation< -180||placement.rotation>180||artifact&&(!artifact.id.trim()||!Number.isFinite(artifact.aspectRatio)||artifact.aspectRatio<=0||artifact.aspectRatio>1000))throw new RangeError('Invalid signature placement');
 const owner=JSON.stringify([...controlIdentity(scope,revision),placement.pageId,artifact?.id,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="PDF signature stamp"><View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{(['ink','image'] as const).map(m=><Button key={m} title={m==='ink'?'Draw signature':'Image signature'} variant="secondary" accessibilityState={{selected:m===mode}} disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onModeChange(m)}/>)}</View>
 {mode==='ink'?<><View style={{flexDirection:'row',gap:8}}>{(['pen','eraser'] as const).map(tool=><Button key={tool} title={tool==='pen'?'Signature pen':'Erase signature ink'} disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.ink.onModeChange(tool)}/>)}</View><View style={{height:180,position:'relative'}}><InkAndLaserPointer {...ink} scope={scope} revision={revision} capture={false} disabled={off||ink.disabled} unstyled={unstyled}/></View><Button title="Create signature from drawn ink" disabled={off||ink.strokes.length===0} unstyled={unstyled} onPress={()=>guard.run('ink',(h,s)=>h.ink.strokes.length?h.onCreateInkArtifact(s):undefined)}/></>:<Button title="Choose signature image" disabled={off} unstyled={unstyled} onPress={()=>guard.run('image',(h,s)=>h.onChooseImage(s))}/>}
 <Text {...{className:unstyled?undefined:'text-text'}}>{artifact?artifact.label:'Create or choose a signature before placing it'}</Text>
 <PointEditor2D scope={scope} revision={revision} points={[{id:'stamp',label:'Stamp position',x:placement.x,y:placement.y}]} selectedId="stamp" onSelect={()=>{}} disabledReason={off?'Signature placement unavailable':undefined} unstyled={unstyled} renderPreview={points=>renderPlacement(artifact,{...placement,x:points[0]!.x,y:points[0]!.y})} onCommit={(point:EditorPoint2D)=>guard.run('placement',(h,s)=>h.onPlacementChange({...h.placement,x:point.x,y:point.y},s))}/>
 <PropertyInspector scope={scope} revision={revision} label="Signature dimensions" disabledReason={off?'Signature placement unavailable':undefined} unstyled={unstyled} fields={[{kind:'number',id:'width',label:'Width relative to page',value:placement.width,min:.001,max:1,step:.001},{kind:'number',id:'rotation',label:'Rotation',value:placement.rotation,min:-180,max:180,step:1,unit:'degrees'}]} onCommit={(id,value)=>guard.run('placement',(h,s)=>h.onPlacementChange({...h.placement,[id]:value},s))}/>
 <Button title={artifact&&placedArtifactId===artifact.id?'Signature stamp acknowledged':'Place signature stamp'} disabled={off||!artifact||!canPlace} unstyled={unstyled} onPress={()=>guard.run('place',(h,s)=>{if(h.artifact&&h.canPlace)return h.onPlace(h.artifact.id,h.placement,s);})}/><ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/></View>;
}
