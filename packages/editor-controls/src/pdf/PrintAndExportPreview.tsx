import type {ReactNode} from 'react';
import {View,Text,type ViewProps} from 'react-native';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface PDFOutputSettings {paperId:string;orientation:'portrait'|'landscape';cropToContent:boolean;qualityDpi:number;scalePercent:number;includeAnnotations:boolean;profileId:string}
export interface PrintAndExportPreviewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 settings:PDFOutputSettings;configurationRevision:string|number;papers:readonly {id:string;label:string}[];
 profiles:readonly {id:string;label:string;requiresValidation:boolean;unavailableReason?:string}[];renderPreview:(settings:PDFOutputSettings)=>ReactNode;
 validation:{status:'not-run'|'running'|'passed'|'failed';configurationRevision:string|number|null;profileId:string|null;message?:string};
 status:'idle'|'rendering'|'ready'|'exporting'|'complete'|'error';progress?:number;error?:string;result:{fileId:string;label:string;bytes:number}|null;
 onSettingsCommit:(settings:PDFOutputSettings,signal?:AbortSignal)=>unknown;onValidate:(signal?:AbortSignal)=>unknown;onExport:(signal?:AbortSignal)=>unknown;onCancel:()=>void;onPrint?:(signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** Actual preview/output/profile-validation telemetry; the native host owns PDF/A checks, printing and output files. */
export function PrintAndExportPreview({scope='pdf-output',revision=0,...props}:PrintAndExportPreviewProps){
 const {settings,configurationRevision,papers,profiles,renderPreview,validation,status,progress,error,result,onSettingsCommit:_settings,onValidate:_validate,onExport:_export,onCancel,onPrint,unstyled=false,disabledReason,style,...rest}=props;
 if(papers.length>256||profiles.length>128||new Set(papers.map(p=>p.id)).size!==papers.length||new Set(profiles.map(p=>p.id)).size!==profiles.length||!['idle','rendering','ready','exporting','complete','error'].includes(status)||progress!==undefined&&(!Number.isFinite(progress)||progress<0||progress>1)||result&&(!result.fileId.trim()||result.fileId.length>8192||!Number.isSafeInteger(result.bytes)||result.bytes<0))throw new RangeError('Invalid PDF output configuration');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),disabledReason])]),busy=status==='rendering'||status==='exporting'||validation.status==='running',guard=useScopedControl(owner,props,disabledReason!==undefined||busy),off=guard.pending||disabledReason!==undefined||busy,profile=profiles.find(p=>p.id===settings.profileId),validated=validation.status==='passed'&&validation.configurationRevision===configurationRevision&&validation.profileId===settings.profileId;
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]} accessibilityLabel="PDF print and export preview"><PropertyInspector scope={owner} label="PDF output settings" disabledReason={off?'Output edit unavailable':undefined} unstyled={unstyled} fields={[
 {kind:'choice',id:'paperId',label:'Paper size',value:settings.paperId,choices:papers},{kind:'choice',id:'orientation',label:'Paper orientation',value:settings.orientation,choices:['portrait','landscape'].map(id=>({id,label:id}))},
 {kind:'boolean',id:'cropToContent',label:'Crop to content',value:settings.cropToContent},{kind:'boolean',id:'includeAnnotations',label:'Include annotations',value:settings.includeAnnotations},
 {kind:'number',id:'qualityDpi',label:'Raster output resolution',value:settings.qualityDpi,min:36,max:2400,step:1,integer:true,unit:'DPI'},
 {kind:'number',id:'scalePercent',label:'Print scale',value:settings.scalePercent,min:1,max:1000,step:1,unit:'%'},
 {kind:'choice',id:'profileId',label:'PDF / archival profile',value:settings.profileId,choices:profiles.map(p=>({id:p.id,label:p.label,disabled:p.unavailableReason!==undefined}))}
 ]} onCommit={(id,v)=>guard.run('settings',(h,s)=>h.onSettingsCommit({...h.settings,[id]:v},s))}/>{renderPreview(settings)}
 <Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>Output {status}{progress===undefined?'':`; ${(progress*100).toFixed(0)}%`} · host profile validation: {validated?'passed for current settings':validation.status==='passed'?'previous settings only':validation.status}</Text>
 {validation.message?<Text {...{className:unstyled?undefined:'text-text-muted'}}>{validation.message}</Text>:null}
 <Button title="Validate selected PDF profile" disabled={off||!profile||profile.unavailableReason!==undefined} unstyled={unstyled} onPress={()=>guard.run('validate',(h,s)=>h.onValidate(s))}/>
 <Button title="Export reviewed PDF" disabled={off||!profile||profile.unavailableReason!==undefined||profile.requiresValidation&&!validated||status!=='ready'} unstyled={unstyled} onPress={()=>guard.run('export',(h,s)=>{const p=h.profiles.find(p=>p.id===h.settings.profileId);if(!p||p.unavailableReason!==undefined||h.status!=='ready'||p.requiresValidation&&!(h.validation.status==='passed'&&h.validation.profileId===p.id&&h.validation.configurationRevision===h.configurationRevision))throw new Error('Current PDF output settings need a valid preview and profile check');return h.onExport(s);})}/>
 {onPrint?<Button title="Open native print dialog" disabled={off||status!=='ready'} unstyled={unstyled} onPress={()=>guard.run('print',(h,s)=>h.status==='ready'?h.onPrint?.(s):undefined)}/>:null}
 {busy||guard.pending?<Button title="Cancel PDF output" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>:null}{result?<Text {...{className:unstyled?undefined:'text-text'}}>Output acknowledged: {result.label} · {result.bytes} bytes</Text>:null}<ErrorMessage {...exact({message:guard.error??error??disabledReason??profile?.unavailableReason,unstyled:unstyled})}/></View>;
}
