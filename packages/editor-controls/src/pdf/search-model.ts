// Portions ported from PdfCraft for Android,
// apps/pdfcraft-android/android/app/src/main/java/io/github/artcraftandroid/pdfcraft/ui/viewer/Search.kt
// at https://github.com/artcraft-android/pdfcraft-android/commit/c643244e0e00c1f0b746ceaff4661a91921e907e
// Copyright (c) 2026 ArtCraft Team and the PdfCraft contributors.
// Licensed under the MIT License or the Apache License, Version 2.0, at your option;
// see licenses/PdfCraft-MIT.txt and licenses/PdfCraft-Apache-2.0.txt.
// Modified by NYC-Tron UI contributors, 2026-11-05: rewritten in TypeScript as pure
// functions over immutable arrays (no Compose state or coroutines); the engine's
// findInPage replaced by matching over a page's extracted text; snippets, the hit cap
// and page grouping added.

/** Most hits one search keeps. Later pages stop adding once it is reached. */
export const PDF_SEARCH_MAX_HITS=1000;
/** Characters of context on each side of a match in a snippet. */
export const PDF_SEARCH_SNIPPET_RADIUS=40;

/** How a query matches page text. */
export interface PdfSearchOptions {
  /** @default false */
  readonly caseSensitive?:boolean;
  /** Match only where the query is bounded by non-letters. @default false */
  readonly wholeWords?:boolean;
}

/**
 * One match: page index (0-based) and char offsets `[start, end)` into that
 * page's extracted text, with the text around it.
 * @see {@linkcode findInPageText}
 */
export interface PdfSearchHit {
  readonly page:number;
  readonly start:number;
  readonly end:number;
  readonly before:string;
  readonly match:string;
  readonly after:string;
}

const WORD=/[\p{L}\p{N}_]/u;

/** Matches of `query` in one page's text, in order, without overlap. */
export function findInPageText(page:number,text:string,query:string,options:PdfSearchOptions={}):PdfSearchHit[]{
  const q=query.trim();
  if(!q)return [];
  const chars=[...text];
  const hay=options.caseSensitive?chars:chars.map(c=>c.toLocaleLowerCase());
  const needle=[...(options.caseSensitive?q:q.toLocaleLowerCase())];
  const out:PdfSearchHit[]=[];
  for(let i=0;i+needle.length<=hay.length;){
    let ok=true;
    for(let k=0;k<needle.length;k++)if(hay[i+k]!==needle[k]){ok=false;break;}
    const end=i+needle.length;
    if(ok&&options.wholeWords&&((i>0&&WORD.test(chars[i-1]!))||(end<chars.length&&WORD.test(chars[end]!))))ok=false;
    if(!ok){i++;continue;}
    out.push(hitWithSnippet(page,chars,i,end));
    i=end;
  }
  return out;
}

function hitWithSnippet(page:number,chars:readonly string[],start:number,end:number):PdfSearchHit{
  const from=Math.max(0,start-PDF_SEARCH_SNIPPET_RADIUS);
  const to=Math.min(chars.length,end+PDF_SEARCH_SNIPPET_RADIUS);
  const flat=(s:string)=>s.replace(/\s+/gu," ");
  return {page,start,end,
    before:(from>0?"…":"")+flat(chars.slice(from,start).join("")).trimStart(),
    match:chars.slice(start,end).join(""),
    after:flat(chars.slice(end,to).join("")).trimEnd()+(to<chars.length?"…":"")};
}

/** Pages to search starting at `fromPage` and wrapping round, so the first hit near the reader shows quickly. */
export function searchPageOrder(pageCount:number,fromPage:number):number[]{
  if(pageCount<=0)return [];
  const start=((Math.trunc(fromPage)%pageCount)+pageCount)%pageCount;
  return Array.from({length:pageCount},(_,k)=>(start+k)%pageCount);
}

/**
 * Adds one page's hits to `hits` keeping page order whatever order pages were
 * searched in. Returns the new list and the shifted current index; the first
 * hits ever found become current. Stops at {@linkcode PDF_SEARCH_MAX_HITS}.
 */
export function insertPageHits(hits:readonly PdfSearchHit[],found:readonly PdfSearchHit[],current:number):{hits:PdfSearchHit[];current:number;capped:boolean}{
  if(found.length===0)return {hits:[...hits],current,capped:false};
  const room=PDF_SEARCH_MAX_HITS-hits.length;
  const add=found.slice(0,Math.max(0,room));
  const page=found[0]!.page;
  let at=hits.findIndex(h=>h.page>page);
  if(at<0)at=hits.length;
  const next=[...hits.slice(0,at),...add,...hits.slice(at)];
  const shifted=current<0?(add.length?at:-1):current>=at?current+add.length:current;
  return {hits:next,current:shifted,capped:add.length<found.length};
}

/** Next (or previous) hit index, wrapping round; -1 when there are none. */
export function stepHit(current:number,count:number,forward:boolean):number{
  if(count<=0)return -1;
  if(current<0)return 0;
  return ((current+(forward?1:-1))%count+count)%count;
}

/** Hits grouped by page in page order, keeping each hit's index in the flat list. */
export function groupHitsByPage(hits:readonly PdfSearchHit[]):Array<{page:number;items:Array<{hit:PdfSearchHit;index:number}>}>{
  const groups:Array<{page:number;items:Array<{hit:PdfSearchHit;index:number}>}>=[];
  hits.forEach((hit,index)=>{
    const last=groups.at(-1);
    if(last&&last.page===hit.page)last.items.push({hit,index});
    else groups.push({page:hit.page,items:[{hit,index}]});
  });
  return groups;
}

/** Search progress in plain speech. */
export function searchSummary(count:number,searched:number,pageCount:number,running:boolean,capped=false):string{
  const matches=count===1?"1 match":count+" matches";
  if(running)return matches+" so far, "+searched+" of "+pageCount+" pages searched";
  return capped?"First "+count+" matches shown":matches;
}
