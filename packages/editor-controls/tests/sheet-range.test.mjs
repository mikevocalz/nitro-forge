import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCellAddress,selectionRange,rangeAddress,rangeCellCount,rangeContains,moveSheetSelection,
  frozenSheetWindow,sheetPrefetchRange,sheetWindow,cellAddress,
} from "../src/sheet-window.ts";
import {rangeToTsv,tsvField,RangeTooLargeError} from "../src/range-tsv.ts";

const ROWS=1048576, COLS=16384;
const bounds={rowCount:ROWS,columnCount:COLS};
const sel=(anchor,focus=anchor)=>({anchor,focus});

test("addresses round-trip and selections normalize to rectangles",()=>{
  assert.deepEqual(parseCellAddress("A1"),{row:0,column:0});
  assert.deepEqual(parseCellAddress("XFD1048576"),{row:ROWS-1,column:COLS-1});
  assert.equal(cellAddress(ROWS-1,COLS-1),"XFD1048576");
  for(const bad of ["","a1","A0","1A","A01","AAAA1"])assert.equal(parseCellAddress(bad),undefined,bad);
  const r=selectionRange(sel("D9","B2"));
  assert.deepEqual(r,{startRow:1,endRow:8,startColumn:1,endColumn:3});
  assert.equal(rangeAddress(r),"B2:D9");
  assert.equal(rangeAddress(selectionRange(sel("C3"))),"C3");
  assert.equal(rangeCellCount(r),24);
  assert.ok(rangeContains(r,4,2));assert.ok(!rangeContains(r,9,2));
  assert.throws(()=>selectionRange(sel("nope")),/Invalid cell/);
});

test("keyboard moves collapse; Shift extends from a fixed anchor",()=>{
  let s=sel("B2");
  s=moveSheetSelection(s,{key:"ArrowRight"},bounds);
  assert.deepEqual(s,sel("C2"));
  s=moveSheetSelection(s,{key:"ArrowDown",shiftKey:true},bounds);
  s=moveSheetSelection(s,{key:"ArrowDown",shiftKey:true},bounds);
  assert.deepEqual(s,{anchor:"C2",focus:"C4"});
  s=moveSheetSelection(s,{key:"Home",shiftKey:true},bounds);
  assert.deepEqual(s,{anchor:"C2",focus:"A4"});
  assert.deepEqual(moveSheetSelection(s,{key:"ArrowUp"},bounds),sel("A3"));
  assert.deepEqual(moveSheetSelection(sel("A1"),{key:"ArrowUp"},bounds),sel("A1"),"clamped");
  assert.deepEqual(moveSheetSelection(sel("A1"),{key:"ArrowLeft"},bounds),sel("A1"));
  assert.equal(moveSheetSelection(s,{key:"q"},bounds),undefined);
});

test("Ctrl/Cmd jumps reach the 1,048,576 x 16,384 edges; Tab and Enter never extend",()=>{
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"End",ctrlKey:true},bounds),sel("XFD1048576"));
  assert.deepEqual(moveSheetSelection(sel("XFD1048576"),{key:"Home",metaKey:true},bounds),sel("A1"));
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"ArrowDown",ctrlKey:true,shiftKey:true},bounds),
    {anchor:"C3",focus:"C1048576"});
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"ArrowRight",metaKey:true},bounds),sel("XFD3"));
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"PageDown"},{...bounds,pageRows:10}),sel("C13"));
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"PageUp"},bounds),sel("C1"));
  assert.deepEqual(moveSheetSelection({anchor:"A1",focus:"C3"},{key:"Tab",shiftKey:true},bounds),sel("B3"));
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"Enter"},bounds),sel("C4"));
  assert.deepEqual(moveSheetSelection(sel("C3"),{key:"Enter",shiftKey:true},bounds),sel("C2"));
  assert.throws(()=>moveSheetSelection(sel("A1"),{key:"ArrowUp"},{rowCount:0,columnCount:1}),/bounds/);
});

test("TSV copy quotes tabs, newlines and quotes and caps huge ranges",()=>{
  assert.equal(tsvField(null),"");
  assert.equal(tsvField(3.5),"3.5");
  assert.equal(tsvField(false),"false");
  assert.equal(tsvField('say "hi"'),'"say ""hi"""');
  assert.equal(tsvField("a\tb"),'"a\tb"');
  assert.equal(tsvField("line\nbreak"),'"line\nbreak"');
  const data={"0,0":"Item","0,1":"Qty","1,0":"Nuts, bolts","1,1":12,"2,0":"Note\nsplit"};
  const tsv=rangeToTsv({startRow:0,endRow:2,startColumn:0,endColumn:1},(r,c)=>data[r+","+c]);
  assert.equal(tsv,'Item\tQty\nNuts, bolts\t12\n"Note\nsplit"\t');
  assert.equal(rangeToTsv({startRow:0,endRow:1,startColumn:0,endColumn:0},()=>"x",{lineEnding:"\r\n"}),"x\r\nx");
  let reads=0;
  assert.throws(()=>rangeToTsv({startRow:0,endRow:ROWS-1,startColumn:0,endColumn:COLS-1},()=>{reads++;return "";}),
    e=>e instanceof RangeTooLargeError&&e.cellCount===ROWS*COLS&&e.maxCells===1_000_000);
  assert.equal(reads,0,"the cap is checked before reading any cell");
  assert.throws(()=>rangeToTsv({startRow:2,endRow:1,startColumn:0,endColumn:0},()=>""),/Invalid copy range/);
});

test("frozen panes stay out of the body window and body indices are absolute",()=>{
  const base={rowCount:ROWS,columnCount:COLS,viewportWidth:1000,viewportHeight:600,
    rowHeight:32,columnWidth:112,rowHeaderWidth:52,columnHeaderHeight:38};
  const top=frozenSheetWindow({...base,scrollX:0,scrollY:0,frozenRows:2,frozenColumns:1});
  assert.equal(top.frozenWidth,112);assert.equal(top.frozenHeight,64);
  assert.equal(top.body.rows.start,2);assert.equal(top.body.columns.start,1);
  assert.equal(top.body.totalHeight,(ROWS-2)*32);
  const far=frozenSheetWindow({...base,scrollX:112*500,scrollY:32*100000,frozenRows:2,frozenColumns:1});
  assert.equal(far.body.rows.start,100000+2-2);
  assert.ok(far.body.rows.end-far.body.rows.start<30);
  assert.equal(far.body.columns.start,500+1-2,"scroll index + frozen - overscan");assert.ok(far.body.columns.end-far.body.columns.start<15);
  const end=frozenSheetWindow({...base,scrollX:112*(COLS-1),scrollY:32*(ROWS-3),frozenRows:2,frozenColumns:1});
  assert.equal(end.body.rows.end,ROWS);assert.equal(end.body.columns.end,COLS);
  const none=frozenSheetWindow({...base,scrollX:0,scrollY:0});
  assert.equal(none.body.rows.start,0);assert.equal(none.frozenWidth,0);
  assert.equal(frozenSheetWindow({...base,rowCount:1,scrollX:0,scrollY:0,frozenRows:5}).frozenRows,1);
  assert.throws(()=>frozenSheetWindow({...base,scrollX:0,scrollY:0,frozenRows:-1}),/nonnegative/);
});

test("prefetch ranges are block-stable, bounded and clamped on a full-size sheet",()=>{
  const opts={rowCount:ROWS,columnCount:COLS};
  const at=(x,y)=>sheetWindow({rowCount:ROWS,columnCount:COLS,scrollX:x,scrollY:y,
    viewportWidth:1000,viewportHeight:600,rowHeight:32,columnWidth:112});
  const a=sheetPrefetchRange(at(0,32*970),opts);
  const b=sheetPrefetchRange(at(0,32*980),opts);
  assert.deepEqual(a,b,"a ten-row scroll inside one block requests nothing new");
  assert.ok(a.startRow<=968&&a.endRow>=1000);
  assert.ok(a.endRow-a.startRow<=64*4,"at most visible blocks plus one lookahead each side");
  assert.equal(a.startRow%64,0);assert.equal(a.endRow%64,0);
  const top=sheetPrefetchRange(at(0,0),opts);
  assert.equal(top.startRow,0);assert.equal(top.startColumn,0);
  const corner=sheetPrefetchRange(at(112*(COLS-5),32*(ROWS-10)),opts);
  assert.equal(corner.endRow,ROWS);assert.equal(corner.endColumn,COLS);
  assert.ok((corner.endRow-corner.startRow)*(corner.endColumn-corner.startColumn)<=64*4*16*4,
    "requested cells stay bounded at the far corner");
  // Sweep the whole sheet: every visible window is inside its prefetch range.
  for(let y=0;y<32*ROWS;y+=32*65537){
    for(let x=0;x<112*COLS;x+=112*4099){
      const w=at(x,y);const p=sheetPrefetchRange(w,opts);
      assert.ok(p.startRow<=w.rows.start&&p.endRow>=w.rows.end);
      assert.ok(p.startColumn<=w.columns.start&&p.endColumn>=w.columns.end);
    }
  }
  assert.throws(()=>sheetPrefetchRange(at(0,0),{...opts,rowBlock:0}),/prefetch/);
});

test("keyboard focus far outside the window scrolls the body just enough to reveal it",async()=>{
  const {revealCellScroll}=await import("../src/sheet-window.ts");
  const g={scrollX:0,scrollY:0,bodyWidth:560,bodyHeight:320,rowHeight:32,columnWidth:112,frozenRows:1,frozenColumns:1};
  assert.deepEqual(revealCellScroll({...g,row:3,column:2}),{x:0,y:0},"already visible");
  assert.deepEqual(revealCellScroll({...g,row:ROWS-1,column:COLS-1}),
    {x:(COLS-1-1)*112+112-560,y:(ROWS-1-1)*32+32-320},"Ctrl+End lands at the bottom-right edge");
  assert.deepEqual(revealCellScroll({...g,scrollX:5000,scrollY:9000,row:2,column:3}),{x:2*112,y:32},"scrolls back");
  assert.deepEqual(revealCellScroll({...g,scrollX:5000,scrollY:9000,row:0,column:0}),{x:5000,y:9000},"frozen cells never scroll");
});
