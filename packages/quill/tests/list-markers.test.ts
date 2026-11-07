import {expect,it} from 'vitest';
import {deriveQuillListMarkers} from '../src/list-markers';
import type {ListDefinition,ListFormat} from '../src/index';
const definition=(id=1,format:ListFormat='decimal',start=1):ListDefinition=>({id,kind:'multilevel',levels:Array.from({length:9},(_,i)=>({format,start,indent_twips:720*(i+1),hanging_twips:360}))});
const item=(d:ListDefinition,level=0)=>({kind:'list' as const,list:{definition:d,level}});
it('projects all six formats and Word repeated-letter boundaries',()=>{
 expect(['bullet','decimal','lowerLetter','upperLetter','lowerRoman','upperRoman'].map(f=>deriveQuillListMarkers([item(definition(1,f as ListFormat,27))])[0])).toEqual(['•','27.','aa.','AA.','xxvii.','XXVII.']);
 expect(deriveQuillListMarkers([item(definition(1,'lowerLetter',26)),item(definition(1,'lowerLetter',26)),item(definition(1,'lowerLetter',26))])).toEqual(['z.','aa.','bb.']);
});
it('continues each instance across paragraphs and resets deeper counters on shallower items',()=>{
 const d=definition(1,'decimal',5),other=definition(2,'decimal',8);
 const source=[item(d),item(d,2),item(d,2),{kind:'para' as const},item(other),item(d,1),item(d,2),item(d),item(d,8)];
 const before=JSON.stringify(source);
 expect(deriveQuillListMarkers(source)).toEqual(['5.','5.','6.','','8.','5.','5.','6.','5.']);
 expect(JSON.stringify(source)).toBe(before);
 expect(deriveQuillListMarkers([{kind:'list'}])).toEqual(['•']);
});
it('rejects corrupt identities and bounded projection violations',()=>{
 const d=definition();
 expect(()=>deriveQuillListMarkers([item(d),item(definition(1,'decimal',2))])).toThrow('Inconsistent');
 expect(()=>deriveQuillListMarkers([item(d,9)])).toThrow('level');
 expect(()=>deriveQuillListMarkers([{...item(d),kind:'para'}])).toThrow('nonlist');
 expect(()=>deriveQuillListMarkers(Array.from({length:10001},()=>item(d)))).toThrow('budget');
 const markers=deriveQuillListMarkers(Array.from({length:10000},()=>item(definition(1,'lowerLetter',9999))));
 expect(markers.at(-1)!.length).toBeLessThan(4096);
});
