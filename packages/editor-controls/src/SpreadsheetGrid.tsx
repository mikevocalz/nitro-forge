import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {FormulaBar} from './spreadsheet/FormulaBar.tsx';
import {controlIdentity,useScopedControl,type ScopedControlProps} from './inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { useEffect,useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, I18nManager, Text, TextInput, Pressable, View, type ViewProps } from "react-native";
import type { ScrollViewInstance } from "react-native";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  cellAddress, columnName, frozenSheetWindow, moveSheetSelection, parseCellAddress, rangeContains, revealCellScroll,
  responsiveSheetMetrics, selectionRange, sheetPrefetchRange, type CellPosition, type SheetRange, type SheetSelection,
} from "./sheet-window.ts";
import { rangeToTsv } from "./range-tsv.ts";
import { tsvToRange, type PasteCell } from "./range-paste.ts";
import { commitCellEdit, selectCellAfterCommit } from "./cell-commit.ts";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { colorReferences, referenceEdges, REFERENCE_TONE_CLASSES } from "./spreadsheet/reference-colors.ts";
import { fillFromEdge, fillTarget, type FillPlan } from "./spreadsheet/fill-handle.ts";
import type { DragPoint, DragTransport } from "@nyc-tron/ui/components/gestures/drag-transport";
import { PanResponderDrag } from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import {exact} from './exact-optional.ts';

/** Only presentation data supplied by the app's TallyDocument.getRange(). */
export interface SpreadsheetCell {
  readonly addr: string;
  readonly raw: string;
  readonly computed: string | number | boolean | null;
}
/**
 * Range {@linkcode SpreadsheetGrid} asks the host to load. `startRow..endRow`
 * and `startColumn..endColumn` (end-exclusive) are block-snapped with one
 * block of lookahead. The request includes only the visible portion of frozen rows `0..frozenRows` and
 * columns `0..frozenColumns`, so the host must load those too.
 */
export interface SpreadsheetWindowRequest {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly frozenRows: number;
  readonly frozenColumns: number;
}
export interface SpreadsheetGridProps extends Omit<ViewProps, "children">,ScopedControlProps {
  readonly sheetId: string;
  readonly readOnly?:boolean;
  /** Display name used to keep `'This Sheet'!A1` references highlighted; other sheets' references are not. */
  readonly sheetName?: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cells: Readonly<Record<string, SpreadsheetCell>>;
  /** Width and height may be provided by the host or measured via onLayout. */
  readonly width?: number;
  readonly height?: number;
  /** Content breakpoint only: never changes foldable hardware navigation. */
  readonly compactBelow?: number;
  readonly rowHeight?: number;
  readonly columnWidth?: number;
  /** Leading rows kept visible above the scrolling body. @default 0 */
  readonly frozenRows?: number;
  /** Leading columns kept visible beside the scrolling body. @default 0 */
  readonly frozenColumns?: number;
  /**
   * Controlled range selection. `focus` is the cell the formula bar edits.
   * Omit to let the grid own selection; pass `null` for "nothing selected".
   */
  readonly selection?: SheetSelection | null;
  readonly onSelectionChange?: ((selection: SheetSelection) => void) | undefined;
  readonly onCommitCell?: ((address:string,raw:string)=>Promise<unknown>|unknown)|undefined;
  /**
   * Ctrl/Cmd+C or the screen-reader "Copy" action. The kit builds the TSV from
   * `cells` (absent addresses are empty fields) and never touches the
   * clipboard; the app writes it.
   */
  readonly onCopyRange?: ((range: SheetRange, tsv: string) => void) | undefined;
  /** Largest selection {@linkcode SpreadsheetGridProps.onCopyRange} serializes. @default 1_000_000 */
  readonly maxCopyCells?: number;
  /**
   * Ctrl/Cmd+V, the browser paste event or the screen-reader "Paste" action.
   * `anchor` is the selection's top-left cell; `cells` are parsed from the
   * clipboard TSV and clamped to this sheet. The grid never mutates `cells`
   * data: the host applies the edits and reject shows the message. Ignored
   * while `readOnly` or `disabledReason` is set.
   */
  readonly onPasteRange?: (anchor: CellPosition, cells: readonly PasteCell[]) => Promise<unknown> | unknown;
  /** Largest paste rectangle accepted. @default 1_000_000 */
  readonly maxPasteCells?: number;
  /**
   * Supplies clipboard text for Ctrl/Cmd+V and the screen-reader "Paste"
   * action, which carry no clipboard data. Browser paste events use their own
   * `clipboardData` and do not need it.
   */
  readonly readClipboard?: () => Promise<string> | string;
  /**
   * Outline the cells each reference in the formula bar points at, one theme
   * tone per distinct reference (the same reference keeps its tone).
   * @default true
   */
  readonly highlightReferences?: boolean;
  /**
   * Fill the selection's contents into a neighbouring range. Supplying it
   * shows the fill handle on the selection's bottom-trailing corner and
   * enables Ctrl/Cmd+D (fill down) and Ctrl/Cmd+R (fill right). The app (the
   * engine) does the fill; reject to show its message. Omit it when the
   * engine has no fill operation, and the handle is not drawn.
   */
  readonly onFillRange?: ((plan: FillPlan) => Promise<unknown> | unknown) | undefined;
  /**
   * Draw something other than the value in a cell, such as a
   * `forge/spreadsheet/Sparkline`. Return `undefined` to show the value. The
   * cell keeps its address and value as its accessibility label; pass
   * `contentLabel` to add a description. `size` is the inner box in points.
   */
  readonly renderCellContent?: (address: string, size: { readonly width: number; readonly height: number }) =>
    { readonly content: ReactNode; readonly contentLabel?: string } | undefined;
  /**
   * Draw the address and formula bar. Turn it off for the second pane of a
   * split view so both panes share one bar. @default true
   */
  readonly showFormulaBar?: boolean;
  /** Drag recognizer for the fill handle. @default PanResponderDrag */
  readonly fillTransport?: DragTransport;
  /** Ask the host's TallyDocument for just this range. */
  readonly onWindowChange?: ((range: SpreadsheetWindowRequest) => void) | undefined;
  readonly className?:string;
  readonly cellClassName?:string;
  readonly headerClassName?:string;
  readonly unstyled?:boolean;
}
type GridLocal = {
  x:number;y:number;draft:string;dirty:boolean;pending:boolean;editVersion:number;error:string|null;
  measuredWidth:number;measuredHeight:number;selection:SheetSelection|null;
  /** Fill-handle drag: where it began and the plan it would apply now. */
  fillFrom:DragPoint|undefined;fillPlan:FillPlan|undefined;
};

function display(value:SpreadsheetCell["computed"]|undefined) {
  if(value === null || value === undefined)return "";
  return String(value);
}
/**
 * Three-pane sheet: frozen headers and frozen rows/columns sit outside the
 * body scroll views and follow them through native-driver transforms, so a
 * fling never shows the strips a frame behind. Only the visible window is
 * rendered on every pane.
 */
export function SpreadsheetGrid({scope='spreadsheet-grid',revision=0,...props}:SpreadsheetGridProps){
 if(!props.sheetId.trim()||props.sheetId.length>256||!Number.isSafeInteger(props.rowCount)||props.rowCount<0||props.rowCount>1048576||!Number.isSafeInteger(props.columnCount)||props.columnCount<0||props.columnCount>16384||Object.keys(props.cells).length>100000)throw new RangeError('Invalid virtual spreadsheet');
 const identity=JSON.stringify([...controlIdentity(scope,revision),props.sheetId]),owner=useEditorBoundary([JSON.stringify([identity,props.readOnly,props.disabledReason])]),guard=useScopedControl(owner,props,props.disabledReason!==undefined),observe=useScopedControl(identity,props,props.disabledReason!==undefined);
 return <SpreadsheetGridBody key={identity} {...props} interactionBoundary={owner} actionError={guard.error}
 onCommitCell={props.onCommitCell&&!props.readOnly&&props.disabledReason===undefined?async(address,raw)=>{const ok=await guard.run('cell',h=>h.onCommitCell?.(address,raw));if(ok!==true)throw new Error('Cell edit was not saved. The draft is retained.');}:undefined}
 onFillRange={props.onFillRange&&!props.readOnly&&props.disabledReason===undefined?async plan=>{const ok=await guard.run('fill',h=>h.onFillRange?.(plan));if(ok!==true)throw new Error('The fill operation did not complete.');}:undefined}
 onSelectionChange={props.onSelectionChange?selection=>guard.current()?.onSelectionChange?.(selection):undefined}
 onCopyRange={props.onCopyRange?(range,tsv)=>guard.current()?.onCopyRange?.(range,tsv):undefined}
 onPasteRange={props.onPasteRange&&!props.readOnly&&props.disabledReason===undefined?async(anchor,cells)=>{const ok=await guard.run('paste',h=>h.onPasteRange?.(anchor,cells));if(ok!==true)throw new Error('The paste did not complete.');}:undefined}
 onWindowChange={props.onWindowChange?range=>observe.current()?.onWindowChange?.(range):undefined}/>;
}
function SpreadsheetGridBody({interactionBoundary,actionError,readOnly,disabledReason,

  sheetId,sheetName,rowCount,columnCount,cells,width,height,rowHeight:preferredRowHeight=32,
  columnWidth:preferredColumnWidth=112,compactBelow=540,frozenRows=0,frozenColumns=0,
  selection:selectionProp,onSelectionChange,onCommitCell,onCopyRange,maxCopyCells=1_000_000,onPasteRange,maxPasteCells=1_000_000,readClipboard,
  highlightReferences=true,onFillRange,renderCellContent,showFormulaBar=true,fillTransport:FillTransport=PanResponderDrag,onWindowChange,
  className,headerClassName,cellClassName,unstyled=false,onLayout,style,...props
}:Omit<SpreadsheetGridProps,'onPasteRange'>&{onPasteRange?:SpreadsheetGridProps['onPasteRange']|undefined;interactionBoundary:string;actionError?:string|null}) {
  const stateRef=useRef<StoreApi<GridLocal>|null>(null);
  if(!stateRef.current)stateRef.current=createStore<GridLocal>(()=>({
    x:0,y:0,draft:"",dirty:false,pending:false,editVersion:0,error:null,measuredWidth:0,measuredHeight:0,selection:null,
    fillFrom:undefined,fillPlan:undefined,
  }));
  const state=stateRef.current;
  useLayoutEffect(()=>{state.setState({fillFrom:undefined,fillPlan:undefined});},[interactionBoundary,width,height,preferredRowHeight,preferredColumnWidth,frozenRows,frozenColumns]);
  const x=useStore(state,s=>s.x);
  const y=useStore(state,s=>s.y);
  const draft=useStore(state,s=>s.draft);
  const dirty=useStore(state,s=>s.dirty);
  const pending=useStore(state,s=>s.pending);
  const fillPlan=useStore(state,s=>s.fillPlan);
  const error=useStore(state,s=>s.error);
  const measuredWidth=useStore(state,s=>s.measuredWidth);
  const measuredHeight=useStore(state,s=>s.measuredHeight);
  const internalSelection=useStore(state,s=>s.selection);
  const selection=selectionProp===undefined?internalSelection:selectionProp;
  const viewportWidth=width??measuredWidth;
  const viewportHeight=height??measuredHeight;
  const metrics=responsiveSheetMetrics({
    width:viewportWidth,rowHeight:preferredRowHeight,
    columnWidth:preferredColumnWidth,compactBelow
  });
  const rowHeight=metrics.rowHeight;
  const columnWidth=metrics.columnWidth;
  const left=metrics.rowHeaderWidth;
  const headerHeight=metrics.columnHeaderHeight;
  const horizontalRef=useRef<ScrollViewInstance>(null);
  const verticalRef=useRef<ScrollViewInstance>(null);
  const scrollX=useRef(new Animated.Value(0)).current;
  const scrollY=useRef(new Animated.Value(0)).current;
  const previousCellMetrics=useRef({
    rowHeight,columnWidth,rowHeaderWidth:metrics.rowHeaderWidth,
  });
  // Body offsets exclude the row header (a separate pane), so keeping the
  // same logical cell at the leading edge is a plain ratio per axis.
  useEffect(()=>{
    const previous=previousCellMetrics.current;
    const next={rowHeight,columnWidth,rowHeaderWidth:metrics.rowHeaderWidth};
    if(previous.rowHeight!==rowHeight || previous.columnWidth!==columnWidth){
      const current=state.getState();
      const anchor={x:current.x*columnWidth/previous.columnWidth,y:current.y*rowHeight/previous.rowHeight};
      state.setState(anchor);
      horizontalRef.current?.scrollTo({x:anchor.x,animated:false});
      verticalRef.current?.scrollTo({y:anchor.y,animated:false});
    }
    previousCellMetrics.current=next;
  },[rowHeight,columnWidth,metrics.rowHeaderWidth,state]);
  const formulaBarHeight=showFormulaBar?metrics.formulaBarHeight:0;
  const gridHeight=Math.max(0,viewportHeight-formulaBarHeight);
  const frozen=frozenSheetWindow({rowCount,columnCount,scrollX:x,scrollY:y,
    viewportWidth,viewportHeight:gridHeight,rowHeight,columnWidth,
    rowHeaderWidth:left,columnHeaderHeight:headerHeight,frozenRows,frozenColumns});
  const fr=frozen.frozenRows;
  const fc=frozen.frozenColumns;
  const visibleFrozenRows=Math.min(fr,Math.max(0,Math.ceil((gridHeight-headerHeight)/rowHeight)));
  const visibleFrozenColumns=Math.min(fc,Math.max(0,Math.ceil((viewportWidth-left)/columnWidth)));
  const body=frozen.body;
  const bodyHeight=Math.max(0,gridHeight-headerHeight-frozen.frozenHeight);
  // An invalid controlled address is a host bug; selectionRange throws with the address.
  const range=useMemo(()=>selection?selectionRange(selection):null,[selection]);
  const focus=range?selection!.focus:"";

  const lastFocus=useRef({sheetId,focus});
  useEffect(()=>{
    if(focus!==lastFocus.current.focus || sheetId!==lastFocus.current.sheetId){
      lastFocus.current={sheetId,focus};
      state.setState({draft:focus?cells[focus]?.raw??"":"",dirty:false,error:null,editVersion:state.getState().editVersion+1});
    }
  },[sheetId,focus,cells,state]);

  const prefetch=sheetPrefetchRange(body,{rowCount,columnCount});
  const onWindowChangeRef=useRef(onWindowChange);
  onWindowChangeRef.current=onWindowChange;
  const ready=viewportWidth>0&&viewportHeight>formulaBarHeight;
  useEffect(()=>{
    if(!ready)return;
    onWindowChangeRef.current?.({...prefetch,frozenRows:visibleFrozenRows,frozenColumns:visibleFrozenColumns});
  },[sheetId,ready,prefetch.startRow,prefetch.endRow,prefetch.startColumn,prefetch.endColumn,fr,fc,visibleFrozenRows,visibleFrozenColumns]);

  const commit=()=>commitCellEdit(focus,onCommitCell,state.getState,patch=>state.setState(patch));
  const select=(next:SheetSelection)=>{
    const apply=()=>{
      if(selectionProp===undefined)state.setState({selection:next});
      onSelectionChange?.(next);
    };
    // Moving only the anchor-to-focus extent keeps the same focus cell; the
    // draft for a new focus cell is only discarded after a successful save.
    if(next.focus===focus){apply();return;}
    void selectCellAfterCommit(state.getState,commit,()=>{
      apply();
      state.setState(current=>({draft:cells[next.focus]?.raw??"",dirty:false,error:null,editVersion:current.editVersion+1}));
    });
  };
  const copy=()=>{
    if(!range||!onCopyRange)return;
    try{
      const tsv=rangeToTsv(range,(r,c)=>cells[cellAddress(r,c)]?.computed,{maxCells:maxCopyCells});
      onCopyRange(range,tsv);
    }catch(e){
      state.setState({error:e instanceof Error?e.message:"Could not copy range"});
    }
  };
  const paste=async(text:string)=>{
    if(!onPasteRange||state.getState().pending)return;
    try{
      const anchor={row:range?.startRow??0,column:range?.startColumn??0};
      const parsed=tsvToRange(text,anchor,{maxCells:maxPasteCells,rowCount,columnCount});
      if(parsed.cells.length===0)return;
      state.setState({pending:true,error:null});
      await onPasteRange(anchor,parsed.cells);
    }catch(e){
      state.setState({error:e instanceof Error?e.message:"Could not paste"});
    }finally{state.setState({pending:false});}
  };
  const pasteFromClipboard=async()=>{
    if(!readClipboard)return;
    try{await paste(await readClipboard());}
    catch(e){state.setState({error:e instanceof Error?e.message:"Could not read the clipboard"});}
  };
  // Fill is an engine write: never optimistic, one at a time, errors shown.
  const fill=async(plan:FillPlan)=>{
    if(!onFillRange||state.getState().pending)return;
    state.setState({pending:true,error:null});
    try{await onFillRange(plan);}
    catch(e){state.setState({error:e instanceof Error?e.message:"Could not fill the range"});}
    finally{state.setState({pending:false});}
  };
  const pageRows=Math.max(1,Math.floor(bodyHeight/rowHeight)-1);
  const bodyWidth=Math.max(0,viewportWidth-left-frozen.frozenWidth);
  const revealCell=(cell:{row:number;column:number})=>{
    const s=state.getState();
    const target=revealCellScroll({row:cell.row,column:cell.column,scrollX:s.x,scrollY:s.y,
      bodyWidth,bodyHeight,rowHeight,columnWidth,frozenRows:fr,frozenColumns:fc});
    if(target.x!==s.x||target.y!==s.y){
      state.setState(target);
      horizontalRef.current?.scrollTo({x:target.x,animated:false});
      verticalRef.current?.scrollTo({y:target.y,animated:false});
    }
  };
  const revealFocus=()=>{
    const cell=focus?parseCellAddress(focus):undefined;
    if(cell&&ready)revealCell(cell);
  };
  // Rotation or a hinge split shrinks the body without moving the focus; the
  // ratio rescale above keeps the top-left cell, so reveal the focus afterwards.
  const revealFocusRef=useRef(revealFocus);
  revealFocusRef.current=revealFocus;
  useEffect(()=>{revealFocusRef.current();},[bodyHeight,bodyWidth,rowHeight,columnWidth,fr,fc]);
  const onKey=(key:string,mods:{shiftKey:boolean;ctrlKey:boolean;metaKey:boolean})=>{
    if(key==="Escape"&&state.getState().fillPlan){state.setState({fillFrom:undefined,fillPlan:undefined});return true;}
    if((mods.ctrlKey||mods.metaKey)&&(key==="c"||key==="C")){copy();return true;}
    // Without readClipboard the browser's paste event delivers the text.
    if((mods.ctrlKey||mods.metaKey)&&(key==="v"||key==="V")&&onPasteRange&&readClipboard){void pasteFromClipboard();return true;}
    if(onFillRange&&range&&(mods.ctrlKey||mods.metaKey)&&(key==="d"||key==="D"||key==="r"||key==="R")){
      const plan=fillFromEdge(range,key==="d"||key==="D"?"down":"right");
      if(plan)void fill(plan);
      return true;
    }
    if(rowCount<1||columnCount<1)return false;
    const current=selection&&range?selection:{anchor:"A1",focus:"A1"};
    const next=moveSheetSelection(current,{key,...mods},{rowCount,columnCount,pageRows});
    if(!next)return false;
    select(next);
    // Ctrl+End or PageDown can move focus outside the rendered window; bring
    // it into view so the focus ring and the formula bar agree.
    revealCell(parseCellAddress(next.focus)!);
    return true;
  };

  const formulaText=dirty?draft:(focus?cells[focus]?.raw??"":"");
  const highlights=useMemo(()=>highlightReferences?colorReferences(formulaText,sheetName).filter(r=>r.onSheet):[],
    [highlightReferences,formulaText,sheetName]);
  const rtl=I18nManager.isRTL;

  // RN Text does not inherit color; every label needs the theme text token or
  // it renders platform-default black on a dark surface.
  const textClass=!unstyled?"text-text":undefined;
  const mutedClass=!unstyled?"text-text-muted":undefined;
  const headerClass=joinClasses(!unstyled&&"border-r border-b border-border bg-surface-sunken",headerClassName);
  const bodyColumns=useMemo(()=>Array.from({length:body.columns.end-body.columns.start},(_,i)=>body.columns.start+i),
    [body.columns.start,body.columns.end]);
  const bodyRows=useMemo(()=>Array.from({length:body.rows.end-body.rows.start},(_,i)=>body.rows.start+i),
    [body.rows.start,body.rows.end]);
  const frozenColumnList=useMemo(()=>Array.from({length:visibleFrozenColumns},(_,i)=>i),[visibleFrozenColumns]);
  const frozenRowList=useMemo(()=>Array.from({length:visibleFrozenRows},(_,i)=>i),[visibleFrozenRows]);
  if((bodyRows.length+visibleFrozenRows)*(bodyColumns.length+visibleFrozenColumns)>16384)throw new RangeError('Spreadsheet pane exceeds the visible-cell drawing budget');
  const leftGap=(body.columns.start-fc)*columnWidth;
  const rightGap=(columnCount-body.columns.end)*columnWidth;
  const topGap=(body.rows.start-fr)*rowHeight;
  const bottomGap=Math.max(0,(rowCount-body.rows.end)*rowHeight);
  const translateX={transform:[{translateX:Animated.multiply(scrollX,-1)}]};
  const translateY={transform:[{translateY:Animated.multiply(scrollY,-1)}]};

  const columnHeader=(col:number)=><View key={col} role="columnheader" accessibilityLabel={`Column ${columnName(col)}`}
    {...{className:headerClass}} style={{width:columnWidth,height:headerHeight,justifyContent:"center",alignItems:"center"}}>
    <Text {...{className:textClass}}>{columnName(col)}</Text>
  </View>;
  const rowHeader=(row:number)=><View key={row} role="rowheader" accessibilityLabel={`Row ${row+1}`}
    {...{className:headerClass}} style={{width:left,height:rowHeight,justifyContent:"center",alignItems:"center"}}>
    <Text {...{className:mutedClass}}>{row+1}</Text>
  </View>;
  const fillHandle=()=>range&&onFillRange&&!pending?<FillTransport
      onBegin={point=>state.setState({fillFrom:point,fillPlan:undefined})}
      onMove={(point,touches)=>{
        const from=state.getState().fillFrom;
        if(!from)return;
        if(touches!==1){state.setState({fillFrom:undefined,fillPlan:undefined});return;}
        const rows=Math.round((point.y-from.y)/rowHeight);
        const columns=Math.round((rtl?from.x-point.x:point.x-from.x)/columnWidth);
        state.setState({fillPlan:fillTarget(range,{rows,columns},{rowCount,columnCount})});
      }}
      onRelease={point=>{
        const from=state.getState().fillFrom;
        const plan=from?fillTarget(range,{rows:Math.round((point.y-from.y)/rowHeight),columns:Math.round((rtl?from.x-point.x:point.x-from.x)/columnWidth)},{rowCount,columnCount}):undefined;
        state.setState({fillFrom:undefined,fillPlan:undefined});
        if(plan)void fill(plan);
      }}
      onCancel={()=>state.setState({fillFrom:undefined,fillPlan:undefined})}>
      {/* 12pt mark, 44pt grab area through hitSlop. */}
      <View aria-hidden hitSlop={16}
        {...{className:joinClasses(!unstyled&&"bg-primary border-2 border-surface-raised")}}
        style={{position:"absolute",bottom:-1,end:-1,width:12,height:12}}/>
    </FillTransport>:null;
  const cell=(row:number,col:number)=>{
    const addr=cellAddress(row,col);
    const inRange=range!==null&&rangeContains(range,row,col);
    const isFocus=addr===focus;
    const refs=highlights.filter(h=>rangeContains(h.range,row,col));
    const referenced=refs.length>0;
    const inFill=fillPlan!==undefined&&rangeContains(fillPlan.target,row,col)&&!inRange;
    const isCorner=range!==null&&row===range.endRow&&col===range.endColumn;
    const value=display(cells[addr]?.computed);
    const custom=renderCellContent?.(addr,{width:Math.max(0,columnWidth-16),height:Math.max(0,rowHeight-8)});
    // Reference outlines sit on an overlay so they never fight the cell's own
    // grid-line border classes. Each reference contributes its own edges.
    const outline=!unstyled&&(referenced||inFill)?joinClasses(...refs.flatMap(ref=>{
      const tone=REFERENCE_TONE_CLASSES[ref.tone]!;
      const e=referenceEdges(ref.range,row,col);
      return [e.top&&tone.top,e.bottom&&tone.bottom,e.start&&tone.start,e.end&&tone.end];
    }),inFill&&"border border-dashed border-primary"):undefined;
    // `role` (not accessibilityRole): "cell" is absent from Android's
    // AccessibilityRole enum, where accessibilityRole would throw.
    return <Pressable
      key={addr}
      role="cell"
      accessibilityLabel={`${addr}, ${value||"empty"}${custom?.contentLabel?`, ${custom.contentLabel}`:""}${referenced?`, referenced by ${refs.map(r=>r.text).join(" and ")}`:""}`}
      accessibilityHint="Select the cell to edit its value in the formula bar. Long press to extend the selection."
      aria-selected={inRange}
      onPress={()=>select({anchor:addr,focus:addr})}
      onLongPress={()=>select({anchor:selection&&range?selection.anchor:addr,focus:addr})}
      {...{className:joinClasses(!unstyled&&"border-r border-b border-border",cellClassName,
        !unstyled&&referenced&&!inRange&&REFERENCE_TONE_CLASSES[refs[0]!.tone]!.fill,
        !unstyled&&inRange&&"bg-primary/10",
        !unstyled&&isFocus&&"border-2 border-focus")}}
      style={{width:columnWidth,height:rowHeight,justifyContent:"center",paddingHorizontal:8}}>
      {custom?custom.content:<Text numberOfLines={1} {...{className:textClass}}>{value}</Text>}
      {outline?<View aria-hidden pointerEvents="none" {...{className:outline}}
        style={{position:"absolute",top:0,bottom:0,start:0,end:0}}/>:null}
      {isCorner?fillHandle():null}
    </Pressable>;
  };
  const cellRow=(row:number,cols:readonly number[],gaps:boolean)=><View key={row} role="row" style={{height:rowHeight,flexDirection:"row"}}>
    {gaps?<View style={{width:leftGap}}/>:null}
    {cols.map(col=>cell(row,col))}
    {gaps?<View style={{width:rightGap}}/>:null}
  </View>;

  return <View {...props}
    onLayout={event=>{
      const {width:nextWidth,height:nextHeight}=event.nativeEvent.layout;
      const current=state.getState();
      if(Number.isFinite(nextWidth)&&Number.isFinite(nextHeight)&&
        nextWidth>=0&&nextHeight>=0&&
        (current.measuredWidth!==nextWidth||current.measuredHeight!==nextHeight)){
        state.setState({measuredWidth:nextWidth,measuredHeight:nextHeight});
      }
      onLayout?.(event);
    }}
    accessibilityLabel={props.accessibilityLabel??"Spreadsheet"}
    {...{className:joinClasses("overflow-hidden",!unstyled&&"border border-border bg-surface-raised",className)}}
    style={[{width:width??"100%",height:height??"100%"},style]}>
    {showFormulaBar?<View style={{
      height:metrics.formulaBarHeight,
      flexDirection:metrics.compact?"column":"row",
      alignItems:metrics.compact?"stretch":"center",
      gap:metrics.compact?4:8,paddingHorizontal:8,
      paddingVertical:metrics.compact?6:0,
    }}>
      <View style={{flexDirection:"row",alignItems:"center",
        justifyContent:"space-between",minWidth:metrics.compact?0:60}}>
        <Text selectable {...{className:textClass}}
          accessibilityLabel={range?`Selected ${range.startRow===range.endRow&&range.startColumn===range.endColumn?"cell":"range"} ${selection!.anchor===focus?focus:`${selection!.anchor} to ${focus}`}`:"No cell selected"}>
          {range?(selection!.anchor===focus?focus:`${selection!.anchor}:${focus}`):""}
        </Text>
        {metrics.compact?<Text numberOfLines={1} style={{fontSize:11}} {...{className:mutedClass}}>
          Swipe sideways for more columns
        </Text>:null}
      </View>
      <FormulaBar scope={sheetId} revision={interactionBoundary} address={focus} value={formulaText} originalValue={focus?cells[focus]?.raw??'':''} pending={pending} readOnly={!focus||!onCommitCell} hideActions unstyled={unstyled}
       style={{flex:metrics.compact?undefined:1,width:metrics.compact?'100%':undefined}}
       onChange={next=>state.setState(current=>({draft:next,dirty:true,editVersion:current.editVersion+1}))}
       onCommit={()=>commit()} onCancel={()=>state.setState(current=>({draft:focus?cells[focus]?.raw??'':'',dirty:false,error:null,editVersion:current.editVersion+1}))}/>

    </View>:null}
    <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/>
    {error?<Text selectable accessibilityLiveRegion="polite" accessibilityRole="alert"
      {...{className:joinClasses("px-2",!unstyled&&"text-danger")}}>{error}</Text>:null}
    {/* Keys are handled here, not on the root, so arrows typed in the formula bar never move the selection. */}
    <View role="grid" focusable
      aria-label={`${sheetName??"Sheet"}, ${rowCount} rows by ${columnCount} columns`}
      accessibilityActions={[
        ...(onCopyRange?[{name:"copy",label:"Copy selection"}]:[]),
        ...(onPasteRange&&readClipboard?[{name:"paste",label:"Paste at selection"}]:[]),
        ...(onFillRange&&range?[{name:"fillDown",label:"Fill down"},{name:"fillRight",label:"Fill right"}]:[]),
      ]}
      onAccessibilityAction={e=>{
        const name=e.nativeEvent.actionName;
        if(name==="copy")copy();
        else if(name==="paste")void pasteFromClipboard();
        else if((name==="fillDown"||name==="fillRight")&&range){
          const plan=fillFromEdge(range,name==="fillDown"?"down":"right");
          if(plan)void fill(plan);
        }
      }}
      {...(onPasteRange?{onPaste:(e:{clipboardData?:{getData(type:string):string};preventDefault?:()=>void})=>{
        const text=e.clipboardData?.getData("text/plain");
        if(typeof text==="string"){e.preventDefault?.();void paste(text);}
      }}:{})}
      onKeyDown={e=>{
        const n=e.nativeEvent;
        if(onKey(n.key,{shiftKey:n.shiftKey,ctrlKey:n.ctrlKey,metaKey:n.metaKey}))e.preventDefault?.();
      }}
      style={{height:gridHeight}}>
      {/* Top band: corner and frozen columns are fixed; column headers and frozen rows follow scrollX. */}
      <View style={{flexDirection:"row"}}>
        <View>
          <View role="row" style={{flexDirection:"row"}}>
            <View {...{className:headerClass}} style={{width:left,height:headerHeight}}/>
            {frozenColumnList.map(columnHeader)}
          </View>
          {frozenRowList.map(row=><View key={row} role="row" style={{flexDirection:"row"}}>
            {rowHeader(row)}{frozenColumnList.map(col=>cell(row,col))}
          </View>)}
        </View>
        <View style={{flex:1,overflow:"hidden"}}>
          <Animated.View style={[{width:body.totalWidth},translateX]}>
            <View role="row" style={{flexDirection:"row"}}>
              <View style={{width:leftGap}}/>
              {bodyColumns.map(columnHeader)}
              <View style={{width:rightGap}}/>
            </View>
            {frozenRowList.map(row=>cellRow(row,bodyColumns,true))}
          </Animated.View>
        </View>
      </View>
      {/* Body band: row headers and frozen columns follow scrollY; the body scrolls on both axes. */}
      <View style={{flexDirection:"row",height:bodyHeight}}>
        <View style={{overflow:"hidden",width:left+frozen.frozenWidth}}>
          <Animated.View style={translateY}>
            <View style={{height:topGap}}/>
            {bodyRows.map(row=><View key={row} role="row" style={{flexDirection:"row"}}>
              {rowHeader(row)}{frozenColumnList.map(col=>cell(row,col))}
            </View>)}
            <View style={{height:bottomGap}}/>
          </Animated.View>
        </View>
        <Animated.ScrollView ref={horizontalRef} horizontal scrollEventThrottle={16} keyboardShouldPersistTaps="handled"
          accessibilityLabel="Spreadsheet grid, scroll sideways for additional columns"
          onScroll={Animated.event([{nativeEvent:{contentOffset:{x:scrollX}}}],{useNativeDriver:true,
            listener:(event:{nativeEvent:{contentOffset:{x:number}}})=>{
              const next=Math.max(0,event.nativeEvent.contentOffset.x);
              if(Math.abs(next-state.getState().x)>columnWidth/4)state.setState({x:next});
            }})}>
          <View style={{width:body.totalWidth}}>
            <Animated.ScrollView ref={verticalRef} nestedScrollEnabled style={{height:bodyHeight}}
              scrollEventThrottle={16}
              onScroll={Animated.event([{nativeEvent:{contentOffset:{y:scrollY}}}],{useNativeDriver:true,
                listener:(event:{nativeEvent:{contentOffset:{y:number}}})=>{
                  const next=Math.max(0,event.nativeEvent.contentOffset.y);
                  if(Math.abs(next-state.getState().y)>rowHeight/3)state.setState({y:next});
                }})}>
              <View style={{height:topGap}}/>
              {bodyRows.map(row=>cellRow(row,bodyColumns,true))}
              <View style={{height:bottomGap}}/>
            </Animated.ScrollView>
          </View>
        </Animated.ScrollView>
      </View>
    </View>
  </View>;
}
