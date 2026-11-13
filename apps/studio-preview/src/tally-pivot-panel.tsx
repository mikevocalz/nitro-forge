import {useEffect,useMemo} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {Banner,Button,Text,View} from '@nitro-forge/studio-workspace/ui';
import {resolveWorkspaceScale,workspaceThemes,type WorkspaceDensity} from '@nitro-forge/studio-workspace/theme';
import {PivotFieldList} from '@nyc-tron/ui/components/forge/spreadsheet/PivotFieldList';
import {rangeAddress,rangeCellCount,type SheetRange} from '@nyc-tron/ui/components/forge/sheet-window';
import type {TallyDocument} from '../../../packages/tally/src/index';
import {
 aggregateTallyPivotValue,assignTallyPivotField,commitTallyPivot,EMPTY_TALLY_PIVOT_SPEC,orderTallyPivotZone,readTallyPivot,readTallyPivotSource,removeTallyPivotAssignment,
 tallyPivotAssignments,tallyPivotFields,tallyPivotOutputAnchor,tallyPivotSourceBounds,type TallyPivotRead,type TallyPivotSource,type TallyPivotSpec,
} from './tally-pivot-wiring';
import {tallyRect} from './tally-rows-wiring';

export interface TallyPivotPanelProps {
 document:TallyDocument;
 sheetId:string;
 sheetName:string;
 /** Grid selection, offered as the pivot source while the sheet has no pivot. */
 range:SheetRange|null;
 /** Changes whenever the authoritative worksheet cells are reloaded. */
 revision:number;
 disabled:boolean;
 /** The detail controls' guarded commit: serializes the write and reloads the worksheet. */
 write:(action:()=>Promise<unknown>)=>Promise<unknown>;
 density:WorkspaceDensity;
 theme:'dark'|'light';
}
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** I-15: PivotFieldList over the sheet's first pivot, or over a host draft until the draft has a source and a value. */
export function TallyPivotPanel(props:TallyPivotPanelProps){
 const {document,sheetId,sheetName,range,revision,disabled,write}=props,scale=resolveWorkspaceScale(props.density),colors=workspaceThemes[props.theme];
 const store=useMemo(()=>createStore(()=>({status:'loading' as 'loading'|'ready'|'error',error:'',retry:0,pivot:null as TallyPivotRead|null,
  draft:null as {source:TallyPivotSource;spec:TallyPivotSpec}|null,sourceError:'',sourcing:false})),[document,sheetId]);
 const state=useStore(store,s=>s);
 useEffect(()=>{
  if(disabled)return;
  let active=true;
  store.setState({status:'loading',error:''});
  void readTallyPivot(document,sheetName).then(pivot=>{if(active)store.setState({pivot,status:'ready'});},error=>{if(active)store.setState({status:'error',error:message(error)});});
  return()=>{active=false;};
 },[document,sheetName,revision,state.retry,disabled,store]);
 const textStyle={color:colors.muted,fontSize:scale.type.body};
 if(state.status==='loading')return <Text accessibilityLiveRegion="polite" style={textStyle}>Reading pivots…</Text>;
 if(state.status==='error')return <View style={{gap:scale.space.element}}><Banner tone="danger" title={state.error} live="alert"/>
  <Button title="Read pivots again" variant="ghost" targetSize={scale.size.target} onPress={()=>store.setState(s=>({retry:s.retry+1}))}/></View>;
 const stored=state.pivot,draft=stored?null:state.draft;
 const source=stored?.source??draft?.source??null,spec=stored?.spec??draft?.spec??EMPTY_TALLY_PIVOT_SPEC;
 const useSelection=async()=>{
  store.setState({sourceError:'',sourcing:true});
  try{
   if(!range||rangeCellCount(range)<2)throw new RangeError('Select at least two cells as the pivot source.');
   const rect=tallyRect(range);tallyPivotSourceBounds(rect);
   const next=await readTallyPivotSource(document,rect);
   store.setState({draft:{source:next,spec:EMPTY_TALLY_PIVOT_SPEC}});
  }catch(error){store.setState({sourceError:message(error)});}
  finally{store.setState({sourcing:false});}
 };
 // Every list callback computes the next spec first (a bad edit throws before any engine call),
 // then stores it: a draft without a value slot stays in host state, anything else is one op.
 const apply=(edit:(spec:TallyPivotSpec,source:TallyPivotSource)=>TallyPivotSpec)=>{
  const current=store.getState(),liveSource=current.pivot?.source??current.draft?.source;
  if(!liveSource)throw new Error('Choose a pivot source first.');
  const before=current.pivot?.spec??current.draft?.spec??EMPTY_TALLY_PIVOT_SPEC,next=edit(before,liveSource);
  if(!current.pivot&&next.values.length===0){store.setState({draft:{source:liveSource,spec:next}});return undefined;}
  return write(async()=>{await commitTallyPivot(document,sheetName,current.pivot?.id??null,liveSource,next);if(!current.pivot)store.setState({draft:null});});
 };
 return <View testID="tally-pivot-panel" style={{gap:scale.space.element}}>
  {!source&&<>
   <Text style={{color:colors.text,fontSize:scale.type.body}}>This sheet has no pivot.</Text>
   <Text style={textStyle}>{range?`Selected ${rangeAddress(range)}. Use it as the source, then add a field to values to create the pivot.`:'Select the source cells in the grid, including every column you want to group or total.'}</Text>
   <Button title="Use selection as pivot source" targetSize={scale.size.target} disabled={disabled||!range||state.sourcing} onPress={()=>{void useSelection();}}/>
   {state.sourceError&&<Banner tone="danger" title={state.sourceError} live="alert"/>}
  </>}
  {source&&<>
   <Text style={{color:colors.text,fontSize:scale.type.body}}>
    {stored?`Pivot ${stored.id} reads ${source.range.from}:${source.range.to}; its output starts at ${stored.output?.anchor??tallyPivotOutputAnchor(source.range)}.`
     :`Draft pivot over ${source.range.from}:${source.range.to}. Add a field to values to create it at ${tallyPivotOutputAnchor(source.range)}.`}</Text>
   <PivotFieldList scope={`tally-pivot:${sheetId}:${stored?.id??'draft'}`} revision={revision} fields={tallyPivotFields(source)} assignments={tallyPivotAssignments(spec)}
    {...(disabled?{disabledReason:'Wait for the worksheet to finish loading.'}:{})}
    onAssign={async (fieldId,zone)=>apply((s,src)=>assignTallyPivotField(s,src,fieldId,zone))}
    onRemove={async id=>apply(s=>removeTallyPivotAssignment(s,id))}
    onAggregate={async (id,aggregate)=>apply((s,src)=>aggregateTallyPivotValue(s,src,id,aggregate))}
    onOrder={async (zone,ids)=>apply(s=>orderTallyPivotZone(s,zone,ids))}/>
   <Text style={textStyle}>A field in filters starts at All: every record passes. There is no value picker yet, so a filter does not narrow the pivot.</Text>
   {stored&&<Button title="Refresh pivot output" targetSize={scale.size.target} disabled={disabled} onPress={()=>{void write(()=>document.refreshPivot(stored.id)).catch(()=>{});}}/>}
   {stored&&<Text style={textStyle}>Field changes and refreshes are separate undo steps. Refresh writes the grid as ordinary cells.</Text>}
   {draft&&<Button title="Discard draft" variant="ghost" targetSize={scale.size.target} onPress={()=>store.setState({draft:null})}/>}
  </>}
 </View>;
}
