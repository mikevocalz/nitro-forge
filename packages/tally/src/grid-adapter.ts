import type { TallyDocument, CellInfo } from "./index";

/**
 * Nonvisual adapter for NYC-Tron's SpreadsheetGrid component.
 * This file does not import React, TanStack, NYC-Tron or Native UI.
 * It translates a bounded 0-based viewport into actual Rust engine requests.
 *
 * Apps own their Zustand window/selection state and fetch lifecycle.
 */
export interface TallyWindowRange {
  /** Inclusive start and exclusive end (as returned by the UI viewport). */
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}
export type TallyGridData = Readonly<Record<string, CellInfo>>;
export type TallyGridDocument = Pick<TallyDocument, "getRange" | "setCell">;

export function tallyColumnName(index:number):string {
  if(!Number.isSafeInteger(index)||index<0||index>16383)
    throw new RangeError("Tally column index must be 0..16383");
  let n=index+1,s="";
  while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}
  return s;
}
export function tallyCellAddress(row:number,column:number):string {
  if(!Number.isSafeInteger(row)||row<0||row>=1048576)
    throw new RangeError("Tally row index out of bounds");
  return tallyColumnName(column)+String(row+1);
}
export function windowToA1Range(range:TallyWindowRange,maxCells=4096):
  { readonly from:string; readonly to:string } | null {
  const {startRow,endRow,startColumn,endColumn}=range;
  if(![startRow,endRow,startColumn,endColumn].every(Number.isSafeInteger) ||
     startRow<0 || startColumn<0 || endRow<startRow || endColumn<startColumn ||
     endRow>1048576 || endColumn>16384 ||
     !Number.isSafeInteger(maxCells) || maxCells<1) {
    throw new RangeError("Invalid Tally grid viewport range");
  }
  if(startRow===endRow || startColumn===endColumn)return null;
  if((endRow-startRow)*(endColumn-startColumn)>maxCells)
    throw new RangeError("Tally grid fetch exceeds viewport cell budget");
  return {
    from:tallyCellAddress(startRow,startColumn),
    to:tallyCellAddress(endRow-1,endColumn-1)
  };
}

/** Query only the visible range. Blank engine cells remain blank. */
export async function readTallyWindow(
  document:TallyGridDocument,range:TallyWindowRange
):Promise<TallyGridData>{
  const a1=windowToA1Range(range);
  if(!a1)return {};
  const response=await document.getRange(a1.from,a1.to);
  const cells=response.data?.cells;
  if(!Array.isArray(cells))throw new Error("Tally returned an invalid range");
  const result:Record<string,CellInfo>=Object.create(null) as Record<string,CellInfo>;
  let count=0;
  for(const row of cells){
    if(!Array.isArray(row))throw new Error("Tally returned a malformed row");
    for(const cell of row){
      if(!cell || typeof cell.addr!=="string" ||
        typeof cell.raw!=="string")throw new Error("Malformed Tally cell");
      if(++count>4096)throw new RangeError("Tally returned too many cells");
      result[cell.addr.toUpperCase()]=cell;
    }
  }
  return result;
}

/**
 * The only write path: TallyDocument.setCell -> Rust EngineHost.
 * This returns the engine's response; never echo a local optimistic value as
 * a confirmed commit. The app refreshes the visible window after completion.
 */
export async function commitTallyGridCell(
  document:TallyGridDocument,
  address:string,
  raw:string
){
  if(!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(address))
    throw new RangeError("Invalid A1 cell address");
  if(typeof raw!=="string")throw new TypeError("Cell source must be text");
  return document.setCell(address,raw);
}
