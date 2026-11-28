import {FlatList,Text,View,type ViewProps} from 'react-native';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface ImportSettings {format:'csv'|'tsv'|'xlsx';encoding:'utf-8'|'utf-16'|'windows-1252';delimiter:string;headers:boolean;worksheetId:string;decimalSeparator:'.'|','}
export interface ImportColumn {id:string;label:string;targetId:string|null;conversion:'text'|'number'|'date'|'boolean'|'skip'}
export interface DataImportWizardProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sourceLabel:string|null;settings:ImportSettings;worksheets:readonly {id:string;label:string}[];columns:readonly ImportColumn[];targets:readonly {id:string;label:string}[];
 preview:readonly {id:string;values:readonly string[];errors:readonly string[]}[];status:'empty'|'loading'|'preview'|'importing'|'complete'|'error';progress?:number;error?:string;canImport:boolean;
 onChooseSource:(signal?:AbortSignal)=>unknown;onSettingsCommit:(settings:ImportSettings,signal?:AbortSignal)=>unknown;onColumnCommit:(column:ImportColumn,signal?:AbortSignal)=>unknown;
 onPreview:(signal?:AbortSignal)=>unknown;onImport:(signal?:AbortSignal)=>unknown;onCancel:()=>void;unstyled?:boolean;
}
/** Host file picker/parser/conversion transactions; preview rows and failures are actual supplied results. */
export function DataImportWizard({scope='data-import',revision=0,...props}:DataImportWizardProps){
 const {sourceLabel,settings,worksheets,columns,targets,preview,status,progress,error,canImport,onChooseSource:_choose,onSettingsCommit:_settings,onColumnCommit:_column,onPreview:_preview,onImport:_import,onCancel,unstyled=false,disabledReason,style,...rest}=props;
 if(worksheets.length>1024||columns.length>512||targets.length>512||preview.length>1000||new Set(columns.map(c=>c.id)).size!==columns.length||preview.some(r=>r.values.length>512||r.errors.length>512||[...r.values,...r.errors].some(v=>v.length>8192))||!['empty','loading','preview','importing','complete','error'].includes(status)||progress!==undefined&&(!Number.isFinite(progress)||progress<0||progress>1)||settings.delimiter.length>4)throw new RangeError('Invalid import preview');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),sourceLabel,disabledReason])]),busy=status==='loading'||status==='importing',guard=useScopedControl(owner,props,disabledReason!==undefined||busy),off=guard.pending||disabledReason!==undefined||busy;
 return <View {...rest} accessibilityLabel="Spreadsheet data import" style={[{gap:tokens.spacing.fixedElement},style]}><Button title="Choose CSV, TSV or XLSX source" disabled={off} unstyled={unstyled} onPress={()=>guard.run('source',(h,s)=>h.onChooseSource(s))}/><Text accessibilityLiveRegion="polite" {...{className:unstyled?undefined:'text-text'}}>{sourceLabel??'No source selected'} · {status}{progress===undefined?'':`; ${(progress*100).toFixed(0)}%`}</Text>
 <PropertyInspector scope={owner} label="Import format" unstyled={unstyled} disabledReason={off?'Import configuration unavailable':undefined} fields={[
 {kind:'choice',id:'format',label:'Source format',value:settings.format,choices:['csv','tsv','xlsx'].map(id=>({id,label:id.toUpperCase()}))},
 {kind:'choice',id:'encoding',label:'Text encoding',value:settings.encoding,choices:['utf-8','utf-16','windows-1252'].map(id=>({id,label:id}))},
 {kind:'text',id:'delimiter',label:'Field delimiter',value:settings.delimiter,maxLength:4},{kind:'boolean',id:'headers',label:'First row contains headers',value:settings.headers},
 {kind:'choice',id:'decimalSeparator',label:'Decimal separator',value:settings.decimalSeparator,choices:[{id:'.',label:'Period'},{id:',',label:'Comma'}]},
 ...(worksheets.length?[{kind:'choice' as const,id:'worksheetId',label:'Workbook worksheet',value:settings.worksheetId,choices:worksheets}]:[])
 ]} onCommit={(id,v)=>guard.run('settings',(h,s)=>h.onSettingsCommit({...h.settings,[id]:v},s))}/>
 <FlatList data={columns} keyExtractor={c=>c.id} style={{maxHeight:controlTokens.extent.list}} initialNumToRender={5} windowSize={5} extraData={off} renderItem={({item})=><View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.off6}}><Text {...{className:unstyled?undefined:'text-text'}}>{item.label}</Text><Select label={'Target for '+item.label} value={item.targetId===null?'none':'target:'+item.targetId} options={[{value:'none',label:'No target column'},...targets.map(t=>({value:'target:'+t.id,label:t.label}))]} disabled={off} unstyled={unstyled} onValueChange={value=>guard.run('mapping',(h,s)=>{const current=h.columns.find(c=>c.id===item.id),id=value==='none'?null:value.slice(7);return current&&(id===null||h.targets.some(t=>t.id===id))?h.onColumnCommit({...current,targetId:id},s):undefined;})}/><Select label={'Conversion for '+item.label} value={item.conversion} options={['text','number','date','boolean','skip'].map(value=>({value,label:value}))} disabled={off} unstyled={unstyled} onValueChange={conversion=>guard.run('conversion',(h,s)=>{const current=h.columns.find(c=>c.id===item.id);return current?h.onColumnCommit({...current,conversion:conversion as ImportColumn['conversion']},s):undefined;})}/></View>}/>
 <Button title="Preview converted rows" disabled={off||sourceLabel===null} unstyled={unstyled} onPress={()=>guard.run('preview',(h,s)=>h.sourceLabel!==null?h.onPreview(s):undefined)}/>
 <FlatList data={preview} keyExtractor={r=>r.id} style={{maxHeight:controlTokens.extent.preview}} initialNumToRender={6} windowSize={5} renderItem={({item})=><View style={{gap:tokens.spacing.fixedStack,paddingVertical:tokens.spacing.off6}}><Text selectable {...{className:unstyled?undefined:'text-text'}}>{item.values.join(' | ')}</Text>{item.errors.map((error,i)=><Text key={i} {...{className:unstyled?undefined:'text-danger'}}>{error}</Text>)}</View>}/>
 <Button title="Import reviewed data" disabled={off||status!=='preview'||!canImport} unstyled={unstyled} onPress={()=>guard.run('import',(h,s)=>h.canImport&&h.status==='preview'?h.onImport(s):undefined)}/>
 {busy||guard.pending?<Button title="Cancel data import" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onCancel();}}/>:null}<ErrorMessage {...exact({message:guard.error??error??disabledReason,unstyled:unstyled})}/></View>;
}
