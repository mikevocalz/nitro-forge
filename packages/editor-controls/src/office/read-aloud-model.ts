// Portions ported from WordCraft for Android, crates/engine/src/speech.rs
// at https://github.com/artcraft-android/wordcraft-android/commit/b2b7cf913c6f61604062e2db30962f32ec921b11
// Copyright (c) 2026 ArtCraft Team and the WordCraft contributors.
// Licensed under the MIT License or the Apache License, Version 2.0, at your option;
// see licenses/WordCraft-MIT.txt and licenses/WordCraft-Apache-2.0.txt.
// Modified by NYC-Tron UI contributors, 2026-11-05: rewritten in TypeScript over plain
// text blocks instead of a WordCraft Document; citation-field skipping and the speech
// worker thread removed (the app owns the voice); playback-rate steps and the reading
// position helpers added.

/** Slowest reading speed, as a multiple of the voice's normal rate. */
export const READ_ALOUD_MIN_RATE=0.5;
/** Fastest reading speed. */
export const READ_ALOUD_MAX_RATE=3;
/** Speeds offered by the rate control, in order. */
export const READ_ALOUD_RATES=[0.5,0.75,1,1.25,1.5,2,3] as const;
/** Longest sentence handed to a voice; longer runs are split at a space. */
export const READ_ALOUD_MAX_SENTENCE=600;
/** Most sentences in one queue. */
export const READ_ALOUD_MAX_SENTENCES=20_000;

/** Words that end with a full stop without ending the sentence. */
const ABBREVIATIONS=new Set([
  "al","e.g","i.e","eg","ie","cf","vs","etc","fig","figs","eq","eqs","no","nos","p","pp","vol","vols","ch","chap","sec","tab",
  "ref","refs","dr","mr","mrs","ms","prof","st","approx","ca","resp","ed","eds","suppl","jr","sr","inc","ltd","co","dept",
  "est","min","max","viz","ibid",
]);
const TERMINAL=new Set([".","!","?","…","。","！","？"]);
const CLOSERS=new Set(["\"","'","”","’",")","]","»",".","!","?"]);
const SPACE=/\s/u;
const ALNUM=/[\p{L}\p{N}]/u;

/** A block of document text the reader can speak: a paragraph, a heading or a PDF page. */
export interface ReadAloudBlock {
  /** The block's place in its document: a Quill block index or a PDF page index. */
  readonly block:number;
  readonly text:string;
}

/**
 * One sentence in the reading queue. `start` and `end` are char offsets into
 * the block's text (end exclusive), so the app can highlight it.
 * @see {@linkcode readAloudSentences}
 */
export interface ReadAloudSentence {
  readonly text:string;
  readonly block:number;
  readonly start:number;
  readonly end:number;
}

/** Sentence spans in `text` as char index ranges `[start, end)`, without surrounding whitespace. */
export function splitSentences(text:string):Array<[number,number]>{
  const chars=[...text];
  const out:Array<[number,number]>=[];
  let start=0,i=0;
  while(i<chars.length){
    const c=chars[i]!;
    let end:number|undefined;
    if(TERMINAL.has(c)){
      let j=i+1;
      while(j<chars.length&&CLOSERS.has(chars[j]!))j++;
      const atEnd=j>=chars.length;
      const spaceAfter=j<chars.length&&SPACE.test(chars[j]!);
      if((atEnd||spaceAfter)&&(c!=="."||!isAbbreviation(chars,start,i)))end=j;
      i=Math.max(j,i+1);
    }else i++;
    // Very long sentences are split at a space so skipping stays fine-grained.
    if(end===undefined&&i-start>=READ_ALOUD_MAX_SENTENCE&&i<chars.length&&SPACE.test(chars[i]!))end=i;
    if(end!==undefined){pushTrimmed(chars,start,end,out);start=end;}
  }
  pushTrimmed(chars,start,chars.length,out);
  return out;
}

function pushTrimmed(chars:readonly string[],a:number,b:number,out:Array<[number,number]>){
  while(a<b&&SPACE.test(chars[a]!))a++;
  while(b>a&&SPACE.test(chars[b-1]!))b--;
  if(a<b)out.push([a,b]);
}

/** Does the full stop at `dot` end an abbreviation ("et al.", "Fig.", "J. Smith") rather than a sentence? */
function isAbbreviation(chars:readonly string[],start:number,dot:number):boolean{
  let w=dot;
  while(w>start&&(ALNUM.test(chars[w-1]!)||chars[w-1]==="."))w--;
  const word=chars.slice(w,dot).join("").toLowerCase();
  if(!word)return false;
  const letters=[...word].filter(c=>c!==".");
  // An initial: "J. Smith", "A. B. Jones".
  if(letters.length===1&&/\p{L}/u.test(letters[0]!))return true;
  return ABBREVIATIONS.has(word);
}

/** Collapses whitespace and tidies empty brackets and spaced punctuation: "( )", " ." → ".". */
export function tidySpoken(s:string):string{
  let t=s.split(/\s+/u).filter(Boolean).join(" ");
  for(;;){
    const before=t;
    for(const [from,to] of [["()",""],["[]",""],["( )",""],["[ ]",""],[" .","."],[" ,",","],[" ;",";"],[" :",":"],["  "," "]] as const){
      t=t.split(from).join(to);
    }
    if(t===before)return t.trim();
  }
}

/**
 * The reading queue for `blocks` in order: one entry per sentence that has a
 * letter or digit in it, capped at {@linkcode READ_ALOUD_MAX_SENTENCES}.
 */
export function readAloudSentences(blocks:readonly ReadAloudBlock[]):ReadAloudSentence[]{
  const out:ReadAloudSentence[]=[];
  for(const b of blocks){
    const chars=[...b.text.replace(/[\t\v\f\u2028\u2029]/gu," ")];
    for(const [a,e] of splitSentences(chars.join(""))){
      if(out.length>=READ_ALOUD_MAX_SENTENCES)return out;
      const spoken=tidySpoken(chars.slice(a,e).join(""));
      if(!ALNUM.test(spoken))continue;
      out.push({text:spoken,block:b.block,start:a,end:e});
    }
  }
  return out;
}

/**
 * Char spans `[start, end)` of the words in a sentence's spoken text, counting
 * only runs between spaces that hold a letter or digit, so punctuation is
 * never a word. A voice's word-boundary callback indexes into this list.
 */
export function wordSpans(text:string):Array<[number,number]>{
  const out:Array<[number,number]>=[];
  const chars=[...text," "];
  let run:[number,boolean]|undefined;
  chars.forEach((c,i)=>{
    if(!SPACE.test(c)){run=[run?.[0]??i,(run?.[1]??false)||ALNUM.test(c)];return;}
    if(run&&run[1])out.push([run[0],i]);
    run=undefined;
  });
  return out;
}

/** Clamps a requested speed into {@linkcode READ_ALOUD_MIN_RATE}..{@linkcode READ_ALOUD_MAX_RATE}. */
export function clampRate(rate:number):number{
  if(!Number.isFinite(rate))return 1;
  return Math.min(READ_ALOUD_MAX_RATE,Math.max(READ_ALOUD_MIN_RATE,rate));
}

/** The next (or previous) offered speed after `rate`, staying at the ends. */
export function stepRate(rate:number,direction:1|-1):number{
  const r=clampRate(rate);
  if(direction>0)return READ_ALOUD_RATES.find(x=>x>r+1e-9)??READ_ALOUD_MAX_RATE;
  return [...READ_ALOUD_RATES].reverse().find(x=>x<r-1e-9)??READ_ALOUD_MIN_RATE;
}

/** "1×", "1.25×". */
export function formatRate(rate:number):string{
  return String(Math.round(clampRate(rate)*100)/100)+"×";
}

/** Reading position in plain speech: "Sentence 3 of 40". */
export function readAloudPosition(index:number,count:number):string{
  if(count<=0)return "Nothing to read";
  return "Sentence "+(Math.min(Math.max(index,0),count-1)+1)+" of "+count;
}

/** The sentence index to resume from at block `block`, or the first sentence after it. */
export function sentenceIndexAtBlock(sentences:readonly ReadAloudSentence[],block:number):number{
  const i=sentences.findIndex(s=>s.block>=block);
  return i<0?Math.max(0,sentences.length-1):i;
}
