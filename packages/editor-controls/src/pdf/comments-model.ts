/**
 * One comment in a thread. `author` and `timeLabel` are optional because a
 * PDF annotation may carry neither.
 * @see {@linkcode CommentThread}
 */
export interface CommentEntry {
  readonly id:string;
  readonly body:string;
  readonly author?:string;
  /** Already formatted by the app in plain speech ("Yesterday", "2 hours ago"). */
  readonly timeLabel?:string;
}

/** A comment and its replies, anchored to a page. Shown by `CommentsThreadPanel`. */
export interface CommentThread extends CommentEntry {
  /** 0-based page index. */
  readonly page:number;
  readonly replies:readonly CommentEntry[];
  /** `undefined` when the document cannot store resolution. */
  readonly resolved?:boolean;
}

/** Which threads the panel lists. */
export type CommentFilter="open"|"resolved"|"all";

/** Threads passing `filter`, grouped by page in page order; threads keep their given order within a page. */
export function groupThreads(threads:readonly CommentThread[],filter:CommentFilter="all"):Array<{page:number;threads:CommentThread[]}>{
  const keep=threads.filter(t=>filter==="all"||(filter==="resolved"?t.resolved===true:t.resolved!==true));
  const pages=new Map<number,CommentThread[]>();
  for(const t of keep){
    if(!Number.isSafeInteger(t.page)||t.page<0)throw new RangeError(`Thread ${t.id} has invalid page ${t.page}`);
    const list=pages.get(t.page)??[];
    list.push(t);
    pages.set(t.page,list);
  }
  return [...pages.entries()].sort((a,b)=>a[0]-b[0]).map(([page,list])=>({page,threads:list}));
}

/** Counts for the filter labels. */
export function threadCounts(threads:readonly CommentThread[]):{open:number;resolved:number;all:number}{
  const resolved=threads.filter(t=>t.resolved===true).length;
  return {open:threads.length-resolved,resolved,all:threads.length};
}

/** A trimmed reply, or `undefined` for a blank one. */
export function resolveReply(draft:string):string|undefined{
  const t=draft.trim();
  return t?t:undefined;
}

/** Screen-reader label for a thread row. */
export function threadLabel(t:CommentThread):string{
  const who=t.author?t.author+": ":"";
  const replies=t.replies.length===0?"":t.replies.length===1?", 1 reply":", "+t.replies.length+" replies";
  return "Page "+(t.page+1)+", "+who+t.body+replies+(t.resolved?", resolved":"");
}
