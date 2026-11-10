import type {BlockKind,ListDefinition,ListFormat,ListItem} from './index';
export interface QuillMarkerBlock {readonly kind:BlockKind;readonly list?:ListItem}
const FORMATS:readonly ListFormat[]=['bullet','decimal','lowerLetter','upperLetter','lowerRoman','upperRoman'];
const KINDS=new Set(['para','h1','h2','h3','list','quote']);
const BULLETS=['•','◦','▪'] as const;
function fingerprint(definition:ListDefinition):string{
 if(!definition||!Number.isSafeInteger(definition.id)||definition.id<1||definition.id>2147483647||!['bullet','numbered','multilevel'].includes(definition.kind)||!Array.isArray(definition.levels)||definition.levels.length!==9)throw new Error('Invalid authoritative list definition');
 for(const level of definition.levels){if(!level||!FORMATS.includes(level.format)||!Number.isSafeInteger(level.start)||level.start<1||level.start>9999||!Number.isSafeInteger(level.indent_twips)||level.indent_twips<0||level.indent_twips>31680||!Number.isSafeInteger(level.hanging_twips)||level.hanging_twips<0||level.hanging_twips>level.indent_twips)throw new Error('Invalid authoritative list level');}
 return JSON.stringify([definition.id,definition.kind,definition.levels.map(l=>[l.format,l.start,l.indent_twips,l.hanging_twips])]);
}
function roman(value:number):string{
 const symbols:readonly (readonly [number,string])[]=[[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
 let result='';for(const [amount,symbol]of symbols)while(value>=amount){result+=symbol;value-=amount;}return result;
}
/** Word-style repeated-letter numbering: z, aa, bb ... zz, aaa. */
function letters(value:number):string{return String.fromCharCode(97+(value-1)%26).repeat(Math.floor((value-1)/26)+1);}
function marker(format:ListFormat,value:number,level:number):string{
 switch(format){case 'bullet':return BULLETS[level%3]!;case 'decimal':return `${value}.`;case 'lowerLetter':return letters(value)+'.';case 'upperLetter':return letters(value).toUpperCase()+'.';case 'lowerRoman':return roman(value)+'.';case 'upperRoman':return roman(value).toUpperCase()+'.';}
}
/**
 * Derive text from one complete authoritative block read. Explicit instance
 * counters continue across other paragraphs/instances, and reset deeper levels
 * when any shallower level occurs (the admitted Word-default behavior).
 * This produces preview metadata; it never changes body text or list state.
 */
export function deriveQuillListMarkers(blocks:readonly QuillMarkerBlock[]):string[]{
 const instances=new Map<number,{fingerprint:string;counters:(number|undefined)[]}>();let count=0;
 return blocks.map(block=>{
  if(!KINDS.has(block.kind))throw new Error('Unknown authoritative block kind');
  if(block.kind!=='list'){if(block.list)throw new Error('List metadata on a nonlist paragraph');return '';}
  if(++count>10000)throw new Error('List marker projection exceeds the paragraph budget');
  if(!block.list)return BULLETS[0]; // Explicitly admitted legacy bullet0, no invented identity.
  const {level,definition}=block.list;
  if(!Number.isSafeInteger(level)||level<0||level>8)throw new Error('Invalid authoritative list level');
  const signature=fingerprint(definition);let instance=instances.get(definition.id);
  if(instance&&instance.fingerprint!==signature)throw new Error('Inconsistent authoritative list definition');
  if(!instance){if(instances.size>=256)throw new Error('List marker projection exceeds the definition budget');instance={fingerprint:signature,counters:Array<number|undefined>(9).fill(undefined)};instances.set(definition.id,instance);}
  const value=instance.counters[level]===undefined?definition.levels[level]!.start:instance.counters[level]!+1;
  instance.counters[level]=value;for(let deeper=level+1;deeper<9;deeper++)instance.counters[deeper]=undefined;
  return marker(definition.levels[level]!.format,value,level);
 });
}
