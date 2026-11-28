import {useLayoutEffect,useRef} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {validatePhotoMetadata,type PhotoMetadata} from './photo-metadata.ts';
import { controlTokens, tokens } from '../tokens.ts';
export type {PhotoMetadata,PhotoProvenanceEntry} from './photo-metadata.ts';
export interface PhotoMetadataInspectorProps extends Omit<ViewProps,'children'> {
 readonly value:PhotoMetadata;readonly annotation:string;readonly onAnnotationCommit:(annotation:string)=>void;readonly disabled?:boolean;readonly unstyled?:boolean;
}
const makeStore=()=>createStore(()=>({scope:'',draft:null as string|null}));
/** Read-only original EXIF/provenance, with a separate host-owned editing annotation. */
export function PhotoMetadataInspector({value,annotation,onAnnotationCommit,disabled=false,unstyled=false,...props}:PhotoMetadataInspectorProps){
 validatePhotoMetadata(value);if(typeof annotation!=='string'||annotation.length>4096)throw new RangeError('Photo annotation exceeds 4096 characters');
 const scope=JSON.stringify([value.photoId,value.revision]);const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,s=>s);
 useLayoutEffect(()=>{store.setState({scope,draft:null});},[scope,store]);
 const draft=s.scope===scope?s.draft:null;
 const apply=()=>{const current=store.getState();if(disabled||current.scope!==scope||current.draft===null)return;const text=current.draft;store.setState({draft:null});if(text!==annotation)onAnnotationCommit(text);};
 const rows:readonly (readonly [string,string|number|null])[]=[['File name',value.fileName],['Media type',value.mimeType],['Pixel dimensions',value.dimensions?`${value.dimensions.width} × ${value.dimensions.height}`:null],['Camera maker',value.cameraMaker],['Camera model',value.cameraModel],['Lens',value.lens],['Capture time (source)',value.capturedAt],['Exposure seconds',value.exposureSeconds],['Aperture f-number',value.aperture],['ISO',value.iso],['Focal length millimeters',value.focalLengthMm]];
 return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>
  {rows.map(([label,number])=><View key={label} style={{gap:tokens.spacing.off2}}><Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{label}</Text><Text selectable {...{className:joinClasses(!unstyled&&'text-text')}}>{number===null?'Not recorded':String(number)}</Text></View>)}
  <Text accessibilityRole="header" {...{className:joinClasses(!unstyled&&'text-text')}}>Source provenance</Text>
  {value.provenance.length?value.provenance.map(entry=><Text key={entry.id} selectable {...{className:joinClasses(!unstyled&&'text-text')}}>{`${entry.label}: ${entry.value}`}</Text>):<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No provenance supplied</Text>}
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Provenance is supplied by the metadata provider; this panel does not verify signatures.</Text>
  <TextInput accessibilityLabel="Photo editing annotation" multiline value={draft??annotation} maxLength={4096} editable={!disabled} aria-disabled={disabled} onChangeText={draft=>{if(!disabled)store.setState({scope,draft});}} onBlur={apply} style={{minHeight:controlTokens.extent.field,padding:tokens.spacing.fixedElement}} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control')}}/>
  <Button title="Save photo annotation" disabled={disabled||draft===null||draft===annotation} unstyled={unstyled} onPress={apply}/>
 </View>;
}
