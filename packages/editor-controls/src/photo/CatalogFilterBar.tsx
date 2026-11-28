import {useRef} from 'react';
import {Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {emptyPhotoCatalogFilter,validateCatalogChoices,validateCatalogFilter,type CatalogChoice,type PhotoCatalogFilter} from './photo-catalog.ts';
export type {PhotoCatalogFilter,CatalogChoice} from './photo-catalog.ts';
export interface CatalogFilterBarProps extends Omit<ViewProps,'children'> {
 readonly catalogId:string;readonly value:PhotoCatalogFilter;readonly cameras:readonly CatalogChoice[];readonly lenses:readonly CatalogChoice[];readonly albums:readonly CatalogChoice[];
 readonly onChange:(filter:PhotoCatalogFilter)=>void;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Explicit host-indexed catalog filters. Unknown EXIF values are not synthesized. */
export function CatalogFilterBar({catalogId,value,cameras,lenses,albums,onChange,disabled=false,unstyled=false,...props}:CatalogFilterBarProps){
 validateCatalogFilter(value);for(const choices of [cameras,lenses,albums])validateCatalogChoices(choices);
 if(!catalogId.trim())throw new TypeError('Catalog filter requires an identity');
 const set=(change:Partial<PhotoCatalogFilter>)=>{if(disabled)return;const next={...value,...change};validateCatalogFilter(next);onChange(next);};
 return <View {...props} style={[{gap:8},props.style]}>
  <TextInput accessibilityLabel="Search photo metadata" value={value.query} maxLength={256} editable={!disabled} aria-disabled={disabled} onChangeText={query=>set({query})} style={{minHeight:44,padding:8}} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control')}}/>
  {([['cameraId','Camera',cameras],['lensId','Lens',lenses],['albumId','Album',albums]] as const).map(([key,label,choices])=>{
   const options=[{value:'',label:`All ${label.toLowerCase()}s`},...choices.map(choice=>({value:choice.id,label:choice.label}))];
   if(value[key]!==null&&!choices.some(choice=>choice.id===value[key]))options.push({value:value[key]!,label:`Unavailable ${label.toLowerCase()}: ${value[key]}`});
   return <Select key={key} label={label} value={value[key]??''} options={options} disabled={disabled} unstyled={unstyled} onValueChange={id=>set({[key]:id||null})}/>;
  })}
  <Select label="Minimum photo stars" value={String(value.minimumStars)} options={Array.from({length:6},(_,stars)=>({value:String(stars),label:stars===0?'Any rating':`${stars} stars or more`}))} disabled={disabled} unstyled={unstyled} onValueChange={stars=>set({minimumStars:Number(stars) as PhotoCatalogFilter['minimumStars']})}/>
  <Select label="Catalog flag" value={value.flag} options={['all','none','pick','reject'].map(value=>({value,label:value}))} disabled={disabled} unstyled={unstyled} onValueChange={flag=>set({flag:flag as PhotoCatalogFilter['flag']})}/>
  {(['dateFrom','dateTo'] as const).map(key=><CatalogDateField key={`${catalogId}:${key}:${value[key]??''}`} label={key==='dateFrom'?'Capture date from':'Capture date through'} value={value[key]} disabled={disabled} unstyled={unstyled} onCommit={date=>set({[key]:date})}/>)}
  {([['iso','ISO',1,409600,1],['aperture','Aperture f-number',.1,128,.1],['shutterSeconds','Shutter seconds',.000001,86400,.001]] as const).map(([key,label,min,max,step])=><View key={key} style={{gap:6}}>
   <SettingSwitch label={`Filter by ${label}`} on={value[key]!==null} onChange={on=>set({[key]:on?[min,max]:null})} disabled={disabled} styled={!unstyled}/>
   {value[key]!==null?<View style={{gap:6}}>{([0,1] as const).map(index=><UnitInput key={index} label={`${label} ${index===0?'minimum':'maximum'}`} value={value[key]![index]} min={index===0?min:value[key]![0]} max={index===0?value[key]![1]:max} step={step} precision={6} disabled={disabled} unstyled={unstyled} onCommit={number=>{const range=[...value[key]!] as [number,number];range[index]=number;set({[key]:range});}}/>)}</View>:null}
  </View>)}
  <Button title="Clear photo filters" disabled={disabled} unstyled={unstyled} onPress={()=>{if(!disabled)onChange(emptyPhotoCatalogFilter());}}/>
 </View>;
}
const makeDateStore=()=>createStore(()=>({draft:null as string|null,error:null as string|null}));
function CatalogDateField({label,value,onCommit,disabled,unstyled}:{label:string;value:string|null;onCommit:(value:string|null)=>void;disabled:boolean;unstyled:boolean}){
 const local=useRef<ReturnType<typeof makeDateStore>|null>(null);local.current??=makeDateStore();const store=local.current,s=useStore(store,s=>s);
 const apply=()=>{if(disabled||store.getState().draft===null)return;const text=store.getState().draft!.trim();try{onCommit(text||null);store.setState({draft:null,error:null});}catch(error){store.setState({error:error instanceof Error?error.message:'Invalid capture date'});}};
 return <View style={{gap:4}}>
  <Text {...{className:joinClasses(!unstyled&&'text-text')}}>{label} (YYYY-MM-DD)</Text>
  <TextInput accessibilityLabel={label} value={s.draft??value??''} maxLength={10} editable={!disabled} aria-disabled={disabled} aria-invalid={s.error!==null} onChangeText={draft=>store.setState({draft,error:null})} onSubmitEditing={apply} returnKeyType="done" style={{minHeight:44,padding:8}} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control')}}/>
  <Button title={`Apply ${label.toLowerCase()}`} disabled={disabled||s.draft===null} unstyled={unstyled} onPress={apply}/>
  {s.error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-danger')}}>{s.error}</Text>:null}
 </View>;
}
