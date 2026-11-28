import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
export interface TypographySettings {kerning:number;tracking:number;leading:number;spaceBefore:number;spaceAfter:number;ligatures:boolean;glyph:string}
export interface TypographyInspectorProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {value:TypographySettings;onCommit:(value:TypographySettings,signal?:AbortSignal)=>unknown}
export function TypographyInspector({value,onCommit,...props}:TypographyInspectorProps){return <PropertyInspector {...props} label="Typography" fields={[
 {kind:'number',id:'kerning',label:'Kerning',value:value.kerning,min:-100,max:100,step:.1,unit:'pt'},
 {kind:'number',id:'tracking',label:'Tracking',value:value.tracking,min:-1000,max:1000,step:1},
 {kind:'number',id:'leading',label:'Line leading',value:value.leading,min:1,max:1000,step:.5,unit:'pt'},
 {kind:'number',id:'spaceBefore',label:'Paragraph space before',value:value.spaceBefore,min:0,max:1000,step:.5,unit:'pt'},
 {kind:'number',id:'spaceAfter',label:'Paragraph space after',value:value.spaceAfter,min:0,max:1000,step:.5,unit:'pt'},
 {kind:'boolean',id:'ligatures',label:'Standard ligatures',value:value.ligatures},
 {kind:'text',id:'glyph',label:'Glyph or Unicode sequence',value:value.glyph,maxLength:64}
 ]} onCommit={(id,v,s)=>onCommit({...value,[id]:v},s)}/>;}
