import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Moved from NYC-Tron UI with the editor controls. The coordinate-admission
// owner tests stay in NYC-Tron (components/gestures); these check that the
// ruler and selection handles use it.
test('ruler and selection handles retain semantic keys and explicitly cancel coordinate admission',()=>{
 const source=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
 const ruler=source('document/ParagraphRuler.tsx'),selection=source('spreadsheet/CellSelectionOverlay.tsx');
 assert.match(ruler,/key=\{m.id\} boundary=\{owner\}/);assert.doesNotMatch(ruler,/key=\{owner/);assert.match(ruler,/useEditorBoundary\(\[boundary,width,disabled\]\)/);
 assert.match(selection,/<RangeHandle key=\{p.id\} boundary=\{owner\}/);assert.doesNotMatch(selection,/key=\{owner/);assert.match(selection,/publish\(owner,host.onPreview,next\)/);assert.match(selection,/return\(\)=>\{previews.current!.clear\(owner\)/);
 for(const text of [ruler,selection])assert.match(text,/gate.finish\(coordinates\)/);
});

test('paragraph ruler measures geometry through the measured coordinate owner',()=>{
 const ruler=readFileSync(new URL('../src/document/ParagraphRuler.tsx',import.meta.url),'utf8');assert.match(ruler,/measurement.current!.measure\(measurementBoundary,e.nativeEvent.layout.width\)/);assert.doesNotMatch(ruler,/onLayout=\{e=>\{if\(!guard.current\(\)\)/);
});
