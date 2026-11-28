/**
 * A heading in a document outline. `block` is its position in the document
 * (a Quill block index), used to follow the caret; `page` is 0-based when the
 * host has laid the document out.
 * @see {@linkcode visibleOutline}
 */
export interface OutlineHeading {
  readonly id:string;
  /** 1 for Heading 1 … 9 for Heading 9. */
  readonly level:number;
  readonly text:string;
  readonly block:number;
  readonly page?:number;
}

/** A row the outline shows: the heading, its depth and whether it has children. */
export interface OutlineRow {
  readonly heading:OutlineHeading;
  readonly index:number;
  readonly depth:number;
  readonly hasChildren:boolean;
  readonly collapsed:boolean;
}

/** Checks levels are 1..9 and blocks never go backwards. */
export function validateOutline(headings:readonly OutlineHeading[]):void{
  let last=-1;
  headings.forEach((h,i)=>{
    if(!Number.isSafeInteger(h.level)||h.level<1||h.level>9)throw new RangeError(`Heading ${i} has invalid level ${h.level}`);
    if(!Number.isSafeInteger(h.block)||h.block<last)throw new RangeError(`Heading ${i} is out of document order`);
    last=h.block;
  });
}

/**
 * Rows to show: headings under a collapsed heading are hidden, and headings
 * deeper than `showLevel` (1–9; 0 shows all) are left out. Depth is relative,
 * so a document that starts at Heading 2 is not indented for nothing.
 */
export function visibleOutline(headings:readonly OutlineHeading[],collapsed:ReadonlySet<string>,showLevel=0):OutlineRow[]{
  validateOutline(headings);
  const shown=headings.map((h,index)=>({h,index})).filter(({h})=>showLevel<=0||h.level<=showLevel);
  const rows:OutlineRow[]=[];
  const stack:number[]=[];
  let hideBelow:number|undefined;
  shown.forEach(({h,index},k)=>{
    if(hideBelow!==undefined&&h.level>hideBelow)return;
    hideBelow=undefined;
    while(stack.length&&stack.at(-1)!>=h.level)stack.pop();
    const next=shown[k+1]?.h;
    const hasChildren=next!==undefined&&next.level>h.level;
    const isCollapsed=hasChildren&&collapsed.has(h.id);
    rows.push({heading:h,index,depth:stack.length,hasChildren,collapsed:isCollapsed});
    stack.push(h.level);
    if(isCollapsed)hideBelow=h.level;
  });
  return rows;
}

/** Index of the heading the caret at `block` sits under, or -1 before the first heading. */
export function headingAtBlock(headings:readonly OutlineHeading[],block:number):number{
  let at=-1;
  for(let i=0;i<headings.length&&headings[i]!.block<=block;i++)at=i;
  return at;
}

/** Index of the visible row that represents heading `index` (itself, or its nearest shown ancestor). */
export function rowForHeading(rows:readonly OutlineRow[],index:number):number{
  let at=-1;
  for(let i=0;i<rows.length&&rows[i]!.index<=index;i++)at=i;
  return at;
}

/** The first heading on each page, for the page list. Pages with no heading map to `undefined`. */
export function headingsByPage(headings:readonly OutlineHeading[],pageCount:number):Array<OutlineHeading|undefined>{
  const out=Array<OutlineHeading|undefined>(Math.max(0,pageCount)).fill(undefined);
  for(const h of headings)if(h.page!==undefined&&h.page>=0&&h.page<out.length&&out[h.page]===undefined)out[h.page]=h;
  return out;
}
