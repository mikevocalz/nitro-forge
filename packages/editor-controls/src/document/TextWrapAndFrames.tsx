import {View,Text} from 'react-native';
import type {ReactNode} from 'react';
import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface TextFrame {id:string;label:string;x:number;y:number;width:number;height:number;anchor:'page'|'paragraph'|'character';wrap:'inline'|'square'|'tight'|'through'|'top-bottom'|'behind'|'front';wrapGap:number;nextId:string|null;oversetCharacters:number}
export interface TextWrapAndFramesProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {
 frames:readonly TextFrame[];selectedId:string|null;renderFrame:(id:string)=>ReactNode;onCommit:(id:string,value:TextFrame,signal?:AbortSignal)=>unknown;
}
function validate(frames:readonly TextFrame[]){if(frames.length>2048||new Set(frames.map(f=>f.id)).size!==frames.length||frames.some(f=>!f.id.trim()||f.id.length>256||!f.label.trim()||f.label.length>1024||![f.x,f.y,f.width,f.height,f.wrapGap].every(Number.isFinite)||f.width<=0||f.height<=0||f.width>14400||f.height>14400||f.wrapGap<0||f.wrapGap>1000||!Number.isSafeInteger(f.oversetCharacters)||f.oversetCharacters<0||f.nextId!==null&&!frames.some(t=>t.id===f.nextId)))throw new RangeError('Invalid text frame roster');for(const f of frames){const seen=new Set<string>();let current:TextFrame|undefined=f;while(current){if(seen.has(current.id))throw new RangeError('Text frame thread cycle');seen.add(current.id);current=frames.find(v=>v.id===current?.nextId);}}}
export function TextWrapAndFrames({frames,selectedId,renderFrame,onCommit,...props}:TextWrapAndFramesProps){
 validate(frames);const f=frames.find(f=>f.id===selectedId);if(!f)return <Text {...{className:props.unstyled?undefined:'text-text'}}>Select a text frame</Text>;
 return <View style={{gap:8}}>{renderFrame(f.id)}<Text {...{className:props.unstyled?undefined:'text-text'}}>Overset text: {f.oversetCharacters} characters</Text><PropertyInspector {...props} label={'Text frame: '+f.label} fields={[
 ...(['x','y','width','height','wrapGap'] as const).map(id=>({kind:'number' as const,id,label:{x:'Horizontal position',y:'Vertical position',width:'Frame width',height:'Frame height',wrapGap:'Text wrap clearance'}[id],value:f[id],min:id==='width'||id==='height' ? .5:id==='x'||id==='y'?-14400:0,max:id==='wrapGap'?1000:14400,step:.5,unit:'pt'})),
 {kind:'choice',id:'anchor',label:'Frame anchor',value:f.anchor,choices:['page','paragraph','character'].map(id=>({id,label:id}))},
 {kind:'choice',id:'wrap',label:'Text wrap',value:f.wrap,choices:['inline','square','tight','through','top-bottom','behind','front'].map(id=>({id,label:id}))},
 {kind:'choice',id:'nextId',label:'Next threaded frame',value:f.nextId===null?'none':'frame:'+f.nextId,choices:[{id:'none',label:'End of thread'},...frames.filter(v=>v.id!==f.id).map(v=>({id:'frame:'+v.id,label:v.label}))]}
 ]} onCommit={(id,v,s)=>{const next={...f,[id]:id==='nextId'?(v==='none'?null:String(v).slice(6)):v};validate(frames.map(old=>old.id===f.id?next:old));return onCommit(f.id,next,s);}}/></View>;
}
