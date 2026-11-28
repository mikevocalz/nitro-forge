import {Text,TextInput,View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {validatePhotoTargets} from './photo-presets.ts';
import {validatePhotoExport,validatePhotoExportProgress,type PhotoBatchExportSettings,type PhotoExportFormat,type PhotoExportProgress} from './photo-export.ts';
export type {PhotoBatchExportSettings,PhotoExportFormat,PhotoExportProgress} from './photo-export.ts';
export interface BatchExportPanelProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly photoIds:readonly string[];readonly value:PhotoBatchExportSettings;readonly formats:readonly PhotoExportFormat[];
 readonly onChange:(settings:PhotoBatchExportSettings)=>void;readonly onExport:(photoIds:readonly string[],settings:PhotoBatchExportSettings,signal:AbortSignal)=>void|Promise<void>;
 readonly progress?:PhotoExportProgress|null;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Configures a host's real batch encoder and reports only provider-supplied progress. */
export function BatchExportPanel({scope,photoIds,value,formats,onChange,onExport,progress=null,disabled=false,unstyled=false,...props}:BatchExportPanelProps){
 validatePhotoTargets(photoIds);validatePhotoExport(value,formats);if(progress!==null)validatePhotoExportProgress(progress);if(!scope.trim())throw new TypeError('Batch export requires a scope');
 const action=useOwnedAction(scope),locked=disabled||action.pending!==null,format=formats.find(format=>format.id===value.formatId)!;
 const set=(change:Partial<PhotoBatchExportSettings>)=>{if(locked)return;const next={...value,...change};validatePhotoExport(next,formats);onChange(next);};
 const watermark=(change:Partial<PhotoBatchExportSettings['watermark']>)=>set({watermark:{...value.watermark,...change}});
 return <View {...props} style={[{gap:8},props.style]}>
  <Select label="Photo export format" value={value.formatId} options={formats.map(format=>({value:format.id,label:format.label}))} disabled={locked} unstyled={unstyled} onValueChange={formatId=>set({formatId})}/>
  <Select label="Photo export sizing" value={value.sizing} options={[{value:'original',label:'Original size'},{value:'fit-long-edge',label:'Fit long edge'}]} disabled={locked} unstyled={unstyled} onValueChange={sizing=>set({sizing:sizing as PhotoBatchExportSettings['sizing']})}/>
  <UnitInput label="Export long edge pixels" value={value.longEdge} min={1} max={65536} precision={0} step={1} disabled={locked||value.sizing==='original'} unstyled={unstyled} onCommit={longEdge=>set({longEdge:Math.round(longEdge)})}/>
  <UnitInput label="Photo export quality" value={value.quality} min={1} max={100} step={1} disabled={locked||!format.supportsQuality} unstyled={unstyled} onCommit={quality=>set({quality})}/>
  <Select label="Photo metadata privacy" value={value.metadata} options={[{value:'strip-all',label:'Remove all metadata'},{value:'copyright-only',label:'Keep copyright only'},{value:'preserve-without-location',label:'Keep metadata, remove location'},{value:'preserve-all',label:'Keep all metadata, including location'}]} disabled={locked} unstyled={unstyled} onValueChange={metadata=>set({metadata:metadata as PhotoBatchExportSettings['metadata']})}/>
  <SettingSwitch label="Add text watermark" on={value.watermark.enabled} onChange={enabled=>watermark({enabled})} disabled={locked} styled={!unstyled}/>
  <TextInput accessibilityLabel="Photo watermark text" value={value.watermark.text} maxLength={256} editable={!locked&&value.watermark.enabled} aria-disabled={locked||!value.watermark.enabled} onChangeText={text=>watermark({text})} style={{minHeight:44,padding:8}} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control')}}/>
  <UnitInput label="Watermark opacity" value={value.watermark.opacity} min={0} max={1} step={.05} disabled={locked||!value.watermark.enabled} unstyled={unstyled} onCommit={opacity=>watermark({opacity})}/>
  <UnitInput label="Watermark font pixels" value={value.watermark.fontSize} min={1} max={1024} step={1} disabled={locked||!value.watermark.enabled} unstyled={unstyled} onCommit={fontSize=>watermark({fontSize})}/>
  <Select label="Watermark position" value={value.watermark.position} options={['top-left','top-right','center','bottom-left','bottom-right'].map(value=>({value,label:value.replaceAll('-',' ')}))} disabled={locked||!value.watermark.enabled} unstyled={unstyled} onValueChange={position=>watermark({position:position as PhotoBatchExportSettings['watermark']['position']})}/>
  {progress?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text')}}>{`${progress.completed} exported; ${progress.failed} failed; ${progress.total} total`}</Text>:action.pending!==null?<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>Export in progress; progress not reported</Text>:null}
  <Button title={`Export ${photoIds.length} photos`} disabled={locked||photoIds.length===0||value.watermark.enabled&&!value.watermark.text.trim()} unstyled={unstyled} onPress={()=>{if(!locked&&photoIds.length&&(!value.watermark.enabled||value.watermark.text.trim()))void action.run('export',signal=>onExport([...photoIds],{...value,watermark:{...value.watermark}},signal));}}/>
  {action.pending!==null?<Button title="Cancel photo export" unstyled={unstyled} onPress={action.cancel}/>:null}
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
 </View>;
}
