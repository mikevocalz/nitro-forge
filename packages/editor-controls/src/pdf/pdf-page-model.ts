export interface PDFPageDescriptor {id:string;label:string;width:number;height:number;rotation:0|90|180|270;canModify:boolean;groupId?:string}
export type PDFPageLayout='single'|'continuous'|'two-up'|'facing';
/** Top-left page coordinates after the host has applied crop/rotation mapping. */
export interface PDFRect {x:number;y:number;width:number;height:number}
export function validatePDFPages(pages:readonly PDFPageDescriptor[]):void{
 if(pages.length>100000||new Set(pages.map(p=>p.id)).size!==pages.length||pages.some(p=>!p.id.trim()||p.id.length>256||!p.label.trim()||p.label.length>1024||![p.width,p.height].every(n=>Number.isFinite(n)&&n>=1&&n<=14400)||![0,90,180,270].includes(p.rotation)))throw new RangeError('Invalid PDF page descriptors');
}
export function validatePDFRect(rect:PDFRect):void{if(![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<0||rect.height<0)throw new RangeError('Invalid PDF rectangle');}
/** One-based ranges such as 1-3, 8, 10; bounded selection metadata, not PDF processing. */
export function parsePDFPageRange(text:string,pageCount:number):number[]{
 if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>100000||text.length>8192)throw new RangeError('Invalid PDF page range');const pages=new Set<number>();
 for(const item of text.split(',')){const match=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(item);if(!match)throw new Error('Use page numbers and ranges such as 1-3, 8');const a=Number(match[1]),b=Number(match[2]??match[1]);if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<1||b<a||b>pageCount)throw new Error('Page range is outside this document');for(let n=a;n<=b;n++)pages.add(n-1);}
 return [...pages].sort((a,b)=>a-b);
}
