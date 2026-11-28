import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Moved from NYC-Tron UI with the editor controls. The measured-drop owner
// tests stay in NYC-Tron (components/gestures); this checks the PDF and pivot
// rows that use it.
test('PDF/pivot rows retain item identity and geometry cancels admission instead of remounting',()=>{
 const pdf=readFileSync(new URL('../src/pdf/PDFThumbnailSidebar.tsx',import.meta.url),'utf8'),pivot=readFileSync(new URL('../src/spreadsheet/PivotFieldList.tsx',import.meta.url),'utf8');
 assert.match(pdf,/<ThumbnailRow[^>]*key=\{item.id\}/);assert.doesNotMatch(pdf,/<ThumbnailRow[^>]*key=\{owner/);
 assert.match(pivot,/<PivotField key=\{item.id\}/);assert.match(pdf,/current\(token,boundary\(\)\)/);assert.match(pivot,/current\(token,expected,'drop'\)/);
 assert.doesNotMatch(pdf,/minDistance:4,maxPointers:1,activeOffsetY/,'RNGH axis offsets must not combine minDistance');
});
