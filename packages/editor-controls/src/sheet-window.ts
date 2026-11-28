/**
 * The 2-D viewport policy for Tally's visible window. Never allocate a
 * million-row workbook in JS just to render a screenful. The Rust Tally engine
 * remains authoritative; TanStack owns only visible row/column presentation.
 */
export interface SheetWindowOptions {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly columnWidth: number;
  readonly rowHeaderWidth?: number;
  readonly columnHeaderHeight?: number;
  readonly overscan?: number;
}
export interface SheetWindow {
  readonly rows: { start: number; end: number };
  readonly columns: { start: number; end: number };
  readonly totalWidth: number;
  readonly totalHeight: number;
}
export function sheetWindow(options: SheetWindowOptions): SheetWindow {
  const {
    rowCount,columnCount,scrollX,scrollY,viewportWidth,viewportHeight,
    rowHeight,columnWidth,rowHeaderWidth=52,columnHeaderHeight=38,overscan=2
  }=options;
  if (![rowCount,columnCount,rowHeight,columnWidth,viewportWidth,viewportHeight,
    scrollX,scrollY,rowHeaderWidth,columnHeaderHeight,overscan].every(Number.isFinite) ||
    !Number.isSafeInteger(rowCount) || rowCount<0 ||
    !Number.isSafeInteger(columnCount) || columnCount<0 ||
    !Number.isSafeInteger(overscan) || overscan<0 ||
    rowHeight<=0 || columnWidth<=0 || viewportWidth<0 || viewportHeight<0 ||
    scrollX<0 || scrollY<0 || rowHeaderWidth<0 || columnHeaderHeight<0) {
    throw new RangeError("Invalid spreadsheet viewport geometry");
  }
  const startRow=Math.max(0,Math.floor(scrollY/rowHeight)-overscan);
  const endRow=Math.min(rowCount,Math.ceil((scrollY + Math.max(0,viewportHeight-columnHeaderHeight))/rowHeight)+overscan);
  const startCol=Math.max(0,Math.floor(Math.max(0,scrollX-rowHeaderWidth)/columnWidth)-overscan);
  const endCol=Math.min(columnCount,Math.ceil((scrollX+viewportWidth)/columnWidth)+overscan);
  return {
    rows:{start:Math.min(rowCount,startRow),end:Math.min(rowCount,Math.max(startRow,endRow))},
    columns:{start:Math.min(columnCount,startCol),end:Math.min(columnCount,Math.max(startCol,endCol))},
    totalWidth:rowHeaderWidth+columnCount*columnWidth,
    totalHeight:columnHeaderHeight+rowCount*rowHeight,
  };
}
export function columnName(index:number):string {
  if(!Number.isSafeInteger(index)||index<0)throw new RangeError("Column must be nonnegative");
  let n=index+1,out="";
  while(n){n-=1;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}
  return out;
}
export function cellAddress(row:number,column:number):string {
  if(!Number.isSafeInteger(row)||row<0)throw new RangeError("Row must be nonnegative");
  return columnName(column)+String(row+1);
}

/**
 * Content-based sheet composition. This does NOT identify a phone or alter
 * app navigation; a narrow foldable pane or resized desktop window receives
 * the same compact *grid* treatment. Columns must never become fake record
 * cards in a formula-bearing spreadsheet.
 */
export interface SheetResponsiveInput {
  readonly width: number;
  readonly rowHeight?: number;
  readonly columnWidth?: number;
  readonly compactBelow?: number;
  readonly touchTarget?: number;
}
export interface SheetResponsiveMetrics {
  readonly compact: boolean;
  readonly rowHeight: number;
  readonly columnWidth: number;
  readonly rowHeaderWidth: number;
  readonly columnHeaderHeight: number;
  readonly formulaBarHeight: number;
}
export function responsiveSheetMetrics({
  width, rowHeight = 32, columnWidth = 112, compactBelow = 540, touchTarget = 44,
}: SheetResponsiveInput): SheetResponsiveMetrics {
  if (![width, rowHeight, columnWidth, compactBelow, touchTarget].every(Number.isFinite) ||
      width < 0 || rowHeight <= 0 || columnWidth <= 0 ||
      compactBelow <= 0 || touchTarget < 24) {
    throw new RangeError("Invalid responsive spreadsheet metrics");
  }
  const compact = width < compactBelow;
  return {
    compact,
    // The height is a touch-target minimum in a narrow pane, not a
    // duplicated row model. Rows and columns keep their stable identities.
    rowHeight: compact ? Math.max(rowHeight, touchTarget) : rowHeight,
    columnWidth: compact ? Math.max(columnWidth, 112) : columnWidth,
    rowHeaderWidth: compact ? 48 : 52,
    columnHeaderHeight: compact ? Math.max(38, touchTarget) : 38,
    formulaBarHeight: compact ? 92 : 46,
  };
}

/** Keep the same logical cell at the top/leading edge after pane resizing. */
export interface SheetScrollMetrics {
  readonly rowHeight: number;
  readonly columnWidth: number;
  readonly rowHeaderWidth: number;
}
export interface SheetScrollPosition {
  readonly x: number;
  readonly y: number;
}
export function reanchorSheetScroll(
  position: SheetScrollPosition,
  before: SheetScrollMetrics,
  after: SheetScrollMetrics,
): SheetScrollPosition {
  const metrics = [
    before.rowHeight,before.columnWidth,before.rowHeaderWidth,
    after.rowHeight,after.columnWidth,after.rowHeaderWidth,position.x,position.y,
  ];
  if (!metrics.every(Number.isFinite) ||
      before.rowHeight<=0 || before.columnWidth<=0 || before.rowHeaderWidth<=0 ||
      after.rowHeight<=0 || after.columnWidth<=0 || after.rowHeaderWidth<=0 ||
      position.x<0 || position.y<0) {
    throw new RangeError("Invalid spreadsheet resize anchors");
  }
  const x=position.x<before.rowHeaderWidth
    ? position.x*after.rowHeaderWidth/before.rowHeaderWidth
    : after.rowHeaderWidth+(position.x-before.rowHeaderWidth)*after.columnWidth/before.columnWidth;
  return { x, y: position.y*after.rowHeight/before.rowHeight };
}

/** Zero-based cell coordinate. */
export interface CellPosition {
  readonly row: number;
  readonly column: number;
}
/** Inclusive rectangular range, normalized so start <= end on both axes. */
export interface SheetRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}
/**
 * A spreadsheet selection. `anchor` is where the selection began and stays
 * put while Shift extends it; `focus` is the active cell the formula bar edits.
 */
export interface SheetSelection {
  readonly anchor: string;
  readonly focus: string;
}
const ADDRESS=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
/** Parses "AA10" into `{row:9,column:26}`; returns `undefined` for anything else. */
export function parseCellAddress(address:string):CellPosition|undefined {
  const m=ADDRESS.exec(address);
  if(!m)return undefined;
  let column=0;
  for(const ch of m[1]!)column=column*26+(ch.charCodeAt(0)-64);
  return {row:Number(m[2])-1,column:column-1};
}
function requireCell(address:string):CellPosition {
  const cell=parseCellAddress(address);
  if(!cell)throw new RangeError("Invalid cell address: "+address);
  return cell;
}
/** The rectangle a {@linkcode SheetSelection} covers. */
export function selectionRange(selection:SheetSelection):SheetRange {
  const a=requireCell(selection.anchor);
  const f=requireCell(selection.focus);
  return {
    startRow:Math.min(a.row,f.row),endRow:Math.max(a.row,f.row),
    startColumn:Math.min(a.column,f.column),endColumn:Math.max(a.column,f.column),
  };
}
/** "B2:D9", or "B2" for one cell. */
export function rangeAddress(range:SheetRange):string {
  const start=cellAddress(range.startRow,range.startColumn);
  const end=cellAddress(range.endRow,range.endColumn);
  return start===end?start:start+":"+end;
}
export function rangeCellCount(range:SheetRange):number {
  return (range.endRow-range.startRow+1)*(range.endColumn-range.startColumn+1);
}
export function rangeContains(range:SheetRange,row:number,column:number):boolean {
  return row>=range.startRow&&row<=range.endRow&&column>=range.startColumn&&column<=range.endColumn;
}
/** The subset of a keyboard event {@linkcode moveSheetSelection} reads. */
export interface SheetKeyInput {
  readonly key: string;
  readonly shiftKey?: boolean;
  /** Ctrl on Windows/Linux/Android, Cmd on Apple platforms. */
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}
export interface SheetBounds {
  readonly rowCount: number;
  readonly columnCount: number;
  /** Rows moved by PageUp/PageDown. @default 20 */
  readonly pageRows?: number;
}
/**
 * Keyboard navigation for a sheet selection. Arrows, Tab/Shift+Tab, Enter/
 * Shift+Enter, Home/End (row edges), Ctrl/Cmd+Home/End (sheet edges),
 * Ctrl/Cmd+Arrow (sheet edge on that axis) and PageUp/PageDown move the
 * focus. With Shift, arrows, Home/End and PageUp/PageDown extend from the
 * anchor; otherwise the selection collapses to the new cell. Returns
 * `undefined` for unhandled keys.
 */
export function moveSheetSelection(
  selection:SheetSelection,input:SheetKeyInput,bounds:SheetBounds,
):SheetSelection|undefined {
  const {rowCount,columnCount,pageRows=20}=bounds;
  if(!Number.isSafeInteger(rowCount)||rowCount<1||!Number.isSafeInteger(columnCount)||columnCount<1||
     !Number.isSafeInteger(pageRows)||pageRows<1){
    throw new RangeError("Invalid sheet bounds");
  }
  const focus=requireCell(selection.focus);
  const jump=input.ctrlKey===true||input.metaKey===true;
  let {row,column}=focus;
  let extendable=true;
  switch(input.key){
    case "ArrowDown":row=jump?rowCount-1:row+1;break;
    case "ArrowUp":row=jump?0:row-1;break;
    case "ArrowRight":column=jump?columnCount-1:column+1;break;
    case "ArrowLeft":column=jump?0:column-1;break;
    case "Home":column=0;if(jump)row=0;break;
    case "End":column=columnCount-1;if(jump)row=rowCount-1;break;
    case "PageDown":row+=pageRows;break;
    case "PageUp":row-=pageRows;break;
    case "Tab":column+=input.shiftKey?-1:1;extendable=false;break;
    case "Enter":row+=input.shiftKey?-1:1;extendable=false;break;
    default:return undefined;
  }
  row=Math.max(0,Math.min(rowCount-1,row));
  column=Math.max(0,Math.min(columnCount-1,column));
  const next=cellAddress(row,column);
  return extendable&&input.shiftKey?{anchor:selection.anchor,focus:next}:{anchor:next,focus:next};
}

/** Options for {@linkcode frozenSheetWindow}: frozen rows/columns stay outside the scroll views. */
export interface FrozenSheetWindowOptions extends SheetWindowOptions {
  readonly frozenRows?: number;
  readonly frozenColumns?: number;
}
/**
 * Window for a sheet with frozen panes. `scrollX`/`scrollY` are offsets of the
 * body scroll views, which start after the row header, column header and
 * frozen strips. Returned body indices are absolute sheet indices.
 */
export interface FrozenSheetWindow {
  readonly frozenRows: number;
  readonly frozenColumns: number;
  readonly body: SheetWindow;
  /** Width/height of the frozen strips, excluding row/column headers. */
  readonly frozenWidth: number;
  readonly frozenHeight: number;
}
export function frozenSheetWindow(options:FrozenSheetWindowOptions):FrozenSheetWindow {
  const {rowCount,columnCount,rowHeight,columnWidth,rowHeaderWidth=52,columnHeaderHeight=38}=options;
  const fr=options.frozenRows??0;
  const fc=options.frozenColumns??0;
  if(!Number.isSafeInteger(fr)||!Number.isSafeInteger(fc)||fr<0||fc<0){
    throw new RangeError("Frozen rows and columns must be nonnegative integers");
  }
  const frozenRows=Math.min(fr,Math.max(0,rowCount));
  const frozenColumns=Math.min(fc,Math.max(0,columnCount));
  const frozenWidth=frozenColumns*columnWidth;
  const frozenHeight=frozenRows*rowHeight;
  const inner=sheetWindow({
    ...options,
    rowCount:Math.max(0,rowCount-frozenRows),columnCount:Math.max(0,columnCount-frozenColumns),
    viewportWidth:Math.max(0,options.viewportWidth-rowHeaderWidth-frozenWidth),
    viewportHeight:Math.max(0,options.viewportHeight-columnHeaderHeight-frozenHeight),
    rowHeaderWidth:0,columnHeaderHeight:0,
  });
  return {
    frozenRows,frozenColumns,frozenWidth,frozenHeight,
    body:{
      rows:{start:inner.rows.start+frozenRows,end:inner.rows.end+frozenRows},
      columns:{start:inner.columns.start+frozenColumns,end:inner.columns.end+frozenColumns},
      totalWidth:inner.totalWidth,totalHeight:inner.totalHeight,
    },
  };
}

/** Block sizes for {@linkcode sheetPrefetchRange}. */
export interface SheetPrefetchOptions {
  readonly rowCount: number;
  readonly columnCount: number;
  /** @default 64 */
  readonly rowBlock?: number;
  /** @default 16 */
  readonly columnBlock?: number;
}
/**
 * Range to request from the engine for a visible window: snapped outward to
 * block boundaries plus one block of lookahead on each side. Small scrolls
 * inside a block return an identical range, so the host is asked again only
 * when the viewport crosses a block edge. End indices are exclusive, matching
 * {@linkcode SheetWindow}.
 */
export function sheetPrefetchRange(
  window:{readonly rows:{start:number;end:number};readonly columns:{start:number;end:number}},
  options:SheetPrefetchOptions,
):{startRow:number;endRow:number;startColumn:number;endColumn:number} {
  const {rowCount,columnCount,rowBlock=64,columnBlock=16}=options;
  if(![rowCount,columnCount,rowBlock,columnBlock].every(Number.isSafeInteger)||
     rowCount<0||columnCount<0||rowBlock<1||columnBlock<1){
    throw new RangeError("Invalid prefetch options");
  }
  const snap=(start:number,end:number,block:number,count:number)=>({
    start:Math.max(0,(Math.floor(start/block)-1)*block),
    end:Math.min(count,(Math.ceil(Math.max(end,start+1)/block)+1)*block),
  });
  const r=snap(window.rows.start,window.rows.end,rowBlock,rowCount);
  const c=snap(window.columns.start,window.columns.end,columnBlock,columnCount);
  return {startRow:r.start,endRow:r.end,startColumn:c.start,endColumn:c.end};
}

/** Geometry {@linkcode revealCellScroll} needs about the body scroll views. */
export interface RevealCellOptions {
  readonly row: number;
  readonly column: number;
  readonly scrollX: number;
  readonly scrollY: number;
  /** Visible body size, excluding headers and frozen strips. */
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly rowHeight: number;
  readonly columnWidth: number;
  readonly frozenRows?: number;
  readonly frozenColumns?: number;
}
/**
 * Smallest body scroll change that brings a cell fully into view, or the
 * current offsets when it already is. Frozen rows/columns never scroll on
 * their axis.
 */
export function revealCellScroll(o:RevealCellOptions):{x:number;y:number} {
  const fr=o.frozenRows??0, fc=o.frozenColumns??0;
  const axis=(index:number,frozen:number,size:number,offset:number,viewport:number)=>{
    if(index<frozen)return offset;
    const start=(index-frozen)*size;
    if(start<offset)return start;
    if(start+size>offset+viewport)return Math.max(0,start+size-viewport);
    return offset;
  };
  return {
    x:axis(o.column,fc,o.columnWidth,o.scrollX,o.bodyWidth),
    y:axis(o.row,fr,o.rowHeight,o.scrollY,o.bodyHeight),
  };
}
