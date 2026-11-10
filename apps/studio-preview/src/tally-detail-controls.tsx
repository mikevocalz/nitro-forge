import {useMemo,useRef} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {Banner,Button,TabBar,Text,TextInput,View} from '@nitro-forge/studio-workspace/ui';
import {resolveWorkspaceScale,workspaceThemes,type WorkspaceDensity} from '@nitro-forge/studio-workspace/theme';
import {FreezeSplitControls} from '@nyc-tron/ui/components/forge/spreadsheet/FreezeSplitControls';
import {rangeAddress,rangeCellCount,responsiveSheetMetrics,selectionRange,type SheetSelection} from '@nyc-tron/ui/components/forge/sheet-window';
import type {SpreadsheetWindowRequest} from '@nyc-tron/ui/components/forge/SpreadsheetGrid';
import type {FreezeState} from '@nyc-tron/ui/components/forge/spreadsheet/freeze-split-model';
import type {TallyDocument} from '../../../packages/tally/src/index';
import {parseTallyCellAddress,tallyCellAddress,TALLY_GRID_MAX_COLUMNS,TALLY_GRID_MAX_ROWS,TALLY_GRID_MAX_WINDOW_CELLS,type TallyGridData} from '../../../packages/tally/src/grid-adapter';

/** Presentation belongs to the active worksheet, never to a native resource. */
export function useTallyDetailView(document:TallyDocument|null,sheetId:string){
 const store=useMemo(()=>createStore(()=>({selection:null as SheetSelection|null,freeze:{frozenRows:0,frozenColumns:0} as FreezeState})),[document,sheetId]);
 const state=useStore(store,s=>s);
 return {...state,getSelection:()=>store.getState().selection,onSelectionChange:(selection:SheetSelection)=>store.setState({selection}),onFreezeChange:(freeze:FreezeState)=>store.setState({freeze})};
}
export interface TallyDetailControlsProps {
 document:TallyDocument;
 sheetId:string;
 cells:TallyGridData;
 selection:SheetSelection|null;
 getSelection:()=>SheetSelection|null;
 freeze:FreezeState;
 viewport:{readonly width:number;readonly height:number};
 window:SpreadsheetWindowRequest;
 onFreezeChange:(freeze:FreezeState)=>void;
 disabled:boolean;
 /** Owns active-sheet verification, serialization and authoritative window refresh. */
 commit:(write:()=>Promise<unknown>)=>Promise<void>;
 density:WorkspaceDensity;
 theme:'dark'|'light';
}
const observed=<T,>(task:Promise<T>)=>{void task.catch(()=>{});return task;};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Plain TSV source only. CSV quoting and locale number conversion are not guessed. */
export function tallyPasteRows(text:string,focus:string):readonly (readonly string[])[]{
 const normalized=text.replace(/\r\n?/g,'\n');
 if(!normalized.length||normalized.length>262144)throw new RangeError('Enter at most 262144 characters of tab-separated cell source.');
 const rows=(normalized.endsWith('\n')?normalized.slice(0,-1):normalized).split('\n').map(row=>row.split('\t'));
 const width=rows[0]!.length;
 if(rows.some(row=>row.length!==width))throw new RangeError('Each pasted row must have the same number of tab-separated columns.');
 if(rows.length*width>TALLY_GRID_MAX_WINDOW_CELLS)throw new RangeError('Apply at most 16384 cells at once.');
 const at=parseTallyCellAddress(focus);
 if(at.row+rows.length>TALLY_GRID_MAX_ROWS||at.column+width>TALLY_GRID_MAX_COLUMNS)throw new RangeError('The pasted cells would exceed the worksheet bounds.');
 return rows;
}
/** Keep a body cell visible and each frozen-prefix fetch within the engine budget. */
export function boundedTallyFreeze(freeze:FreezeState,viewport:{readonly width:number;readonly height:number},target:number,window:SpreadsheetWindowRequest):FreezeState {
 if(![freeze.frozenRows,freeze.frozenColumns].every(value=>Number.isSafeInteger(value)&&value>=0))throw new RangeError('Invalid frozen prefix');
 if(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width<=0||viewport.height<=0)return {frozenRows:0,frozenColumns:0};
 const metrics=responsiveSheetMetrics({width:viewport.width,rowHeight:target,columnWidth:112});
 const bodyRows=Math.max(1,window.endRow-window.startRow),bodyColumns=Math.max(1,window.endColumn-window.startColumn);
 const maxRows=Math.max(0,Math.min(TALLY_GRID_MAX_ROWS,Math.floor((viewport.height-metrics.formulaBarHeight-metrics.columnHeaderHeight-metrics.rowHeight)/metrics.rowHeight),Math.floor(TALLY_GRID_MAX_WINDOW_CELLS/bodyColumns)));
 const maxColumns=Math.max(0,Math.min(TALLY_GRID_MAX_COLUMNS,Math.floor((viewport.width-metrics.rowHeaderWidth-metrics.columnWidth)/metrics.columnWidth),Math.floor(TALLY_GRID_MAX_WINDOW_CELLS/bodyRows)));
 const frozenRows=Math.min(freeze.frozenRows,maxRows);
 return {frozenRows,frozenColumns:Math.min(freeze.frozenColumns,maxColumns,Math.floor(TALLY_GRID_MAX_WINDOW_CELLS/Math.max(1,frozenRows)))};
}
/** Composes supported engine data operations and canonical freeze commands. */
export function TallyDetailControls(props:TallyDetailControlsProps){
 const {document,sheetId,cells,selection,disabled}=props,scale=resolveWorkspaceScale(props.density),colors=workspaceThemes[props.theme];
 const store=useMemo(()=>createStore(()=>({panel:'selection' as 'selection'|'data'|'view',text:'',error:''})),[document,sheetId]);
 const state=useStore(store,s=>s);
 const latest=useRef({document,sheetId,cells,selection,disabled});latest.current={document,sheetId,cells,selection,disabled};
 const authority=useRef({cells,revision:0});if(authority.current.cells!==cells)authority.current={cells,revision:authority.current.revision+1};
 const boundary=JSON.stringify([sheetId,authority.current.revision,selection?.anchor,selection?.focus,disabled]);
 const range=selection?selectionRange(selection):null,count=range?rangeCellCount(range):0;
 const write=(action:()=>Promise<unknown>)=>{
  const current=latest.current;
  if(disabled||current.disabled||current.document!==document||current.sheetId!==sheetId||current.cells!==cells||current.selection!==selection||props.getSelection()!==selection)
   return observed(Promise.reject(new Error('Wait for the current worksheet selection to finish loading.')));
  return observed(props.commit(action));
 };
 const attempt=(action:()=>Promise<unknown>)=>{store.setState({error:''});void Promise.resolve().then(action).catch(error=>{if(latest.current.document===document&&latest.current.sheetId===sheetId)store.setState({error:message(error)});});};
 const changeFreeze=(next:FreezeState)=>{
  if(next.frozenRows===0&&next.frozenColumns===0){store.setState({error:''});props.onFreezeChange(next);return;}
  try{
   if(!Number.isFinite(props.viewport.width)||!Number.isFinite(props.viewport.height)||props.viewport.width<=0||props.viewport.height<=0)
    throw new Error('Wait for the worksheet viewport before freezing panes.');
   const bounded=boundedTallyFreeze(next,props.viewport,scale.size.target,props.window);
   if(bounded.frozenRows!==next.frozenRows||bounded.frozenColumns!==next.frozenColumns)
    throw new Error('Frozen panes must leave a visible body row and column and stay within the worksheet read budget.');
   store.setState({error:''});props.onFreezeChange(next);
  }catch(error){store.setState({error:message(error)});}
 };
 const clear=()=>{
  if(!range||count<1||count>TALLY_GRID_MAX_WINDOW_CELLS)throw new RangeError('Select between 1 and 16384 cells to clear.');
  const rows=Array.from({length:range.endRow-range.startRow+1},()=>Array.from({length:range.endColumn-range.startColumn+1},()=>''));
  return write(()=>document.setRange(tallyCellAddress(range.startRow,range.startColumn),rows));
 };
 return <View testID="tally-detail-controls" style={{padding:scale.space.inset,gap:scale.space.element}}>
  <TabBar semantics="tabs" density="compact" aria-label="Worksheet tools" tabs={(['selection','data','view'] as const).map(panel=>({key:panel,label:panel==='selection'?'Selection':panel==='data'?'Data':'View',icon:null,active:state.panel===panel,onPress:()=>store.setState({panel,error:''})}))}/>
  {state.error&&<Banner tone="danger" title={state.error} live="alert"/>}
  {state.panel==='selection'&&<>
   <Text style={{color:colors.text,fontSize:scale.type.body}}>{range?`${rangeAddress(range)} · ${count} cell${count===1?'':'s'}`:'Select a cell or range in the grid.'}</Text>
   <Button title="Clear selected cells" variant="ghost" targetSize={scale.size.target} disabled={disabled||!range||count>TALLY_GRID_MAX_WINDOW_CELLS} onPress={()=>attempt(clear)}/>
  </>}
  {state.panel==='data'&&<>
   <Text style={{color:colors.muted,fontSize:scale.type.body}}>{selection?`Apply tab-separated source at ${selection.focus}. Formulas are evaluated by Tally.`:'Select the first destination cell in the grid.'}</Text>
   <TextInput accessibilityLabel="Tab-separated cell source" multiline maxLength={262144} editable={!disabled} value={state.text}
    onChangeText={text=>store.setState({text,error:''})} style={{height:120,minHeight:96,textAlignVertical:'top',padding:scale.space.inset,color:colors.text,backgroundColor:colors.raised,borderColor:colors.line,borderWidth:1,borderRadius:scale.radius.control}}/>
   <Button title="Apply cell source" variant="ghost" targetSize={scale.size.target} disabled={disabled||!selection||!state.text.length}
    onPress={()=>attempt(()=>{if(!selection)throw new Error('Select a destination cell.');const rows=tallyPasteRows(state.text,selection.focus);return write(()=>document.setRange(selection.focus,rows));})}/>
  </>}
  {state.panel==='view'&&<>
   <FreezeSplitControls key={boundary} freeze={props.freeze} onFreezeChange={changeFreeze} {...(selection?{focus:selection.focus}:{})}/>
   <Text style={{color:colors.muted,fontSize:scale.type.body}}>Frozen panes are view settings. They are not saved in the workbook.</Text>
  </>}
 </View>;
}
