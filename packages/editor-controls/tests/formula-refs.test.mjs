import test from "node:test";
import assert from "node:assert/strict";
import {formulaReferences,referenceHighlights} from "../src/formula-refs.ts";

const texts=f=>formulaReferences(f).map(r=>r.text);

test("finds cells and ranges with absolute markers and exact offsets",()=>{
  const refs=formulaReferences("=SUM($A$1:B$9)+c3*2");
  assert.deepEqual(refs.map(r=>[r.text,r.start,r.end]),[["$A$1:B$9",5,13],["c3",15,17]]);
  assert.deepEqual(refs[0].range,{startRow:0,endRow:8,startColumn:0,endColumn:1});
  assert.deepEqual(refs[1].range,{startRow:2,endRow:2,startColumn:2,endColumn:2});
  assert.deepEqual(formulaReferences("=D9:B2")[0].range,{startRow:1,endRow:8,startColumn:1,endColumn:3});
});

test("ignores strings, function names, identifiers and out-of-grid tokens",()=>{
  assert.deepEqual(texts('="A1 and ""B2"""&C3'),["C3"]);
  assert.deepEqual(texts("=LOG10(A2)+ATAN2(B1,B2)"),["A2","B1","B2"]);
  assert.deepEqual(texts("=SUMA1+A1B+A1"),["A1"]);
  assert.deepEqual(texts("=XFE1+A0+A1048577+XFD1048576"),["XFD1048576"]);
  assert.deepEqual(texts("A1+B2"),[],"not a formula");
  assert.deepEqual(texts("=1.5E3+A1"),["A1"]);
  assert.deepEqual(texts("=A1:LOG10(B1)"),["A1","B1"],"a rejected range still yields its first cell");
});

test("sheet-qualified references keep their sheet and only the current sheet is highlighted",()=>{
  const refs=formulaReferences("=Data!B2+'Q1 Plan'!C3:D4+'It''s'!A1+E5");
  assert.deepEqual(refs.map(r=>[r.sheet,r.text]),[
    ["Data","Data!B2"],["Q1 Plan","'Q1 Plan'!C3:D4"],["It's","'It''s'!A1"],[undefined,"E5"],
  ]);
  assert.deepEqual(referenceHighlights("=Data!B2+'Q1 Plan'!C3:D4+E5","q1 plan").map(h=>[h.index,h.text]),
    [[0,"'Q1 Plan'!C3:D4"],[1,"E5"]]);
  assert.deepEqual(referenceHighlights("=Data!B2+E5").map(h=>h.text),["E5"]);
  assert.deepEqual(referenceHighlights("plain text"),[]);
});
