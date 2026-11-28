export interface PhotoExportFormat {readonly id:string;readonly label:string;readonly supportsQuality:boolean}
export interface PhotoBatchExportSettings {
 readonly formatId:string;readonly sizing:'original'|'fit-long-edge';readonly longEdge:number;readonly quality:number;
 readonly metadata:'strip-all'|'copyright-only'|'preserve-without-location'|'preserve-all';
 readonly watermark:{readonly enabled:boolean;readonly text:string;readonly opacity:number;readonly fontSize:number;readonly position:'top-left'|'top-right'|'center'|'bottom-left'|'bottom-right'};
}
export interface PhotoExportProgress {readonly completed:number;readonly failed:number;readonly total:number}
export function defaultPhotoBatchExport(formatId:string):PhotoBatchExportSettings{return {formatId,sizing:'original',longEdge:2048,quality:90,metadata:'preserve-without-location',watermark:{enabled:false,text:'',opacity:.7,fontSize:24,position:'bottom-right'}};}
export function validatePhotoExport(value:PhotoBatchExportSettings,formats:readonly PhotoExportFormat[]):void {
 const ids=new Set<string>();for(const format of formats){if(!format.id.trim()||!format.label.trim()||typeof format.supportsQuality!=='boolean'||ids.has(format.id))throw new TypeError('Invalid photo export formats');ids.add(format.id);}
 if(!ids.has(value.formatId)||!['original','fit-long-edge'].includes(value.sizing)||!Number.isInteger(value.longEdge)||value.longEdge<1||value.longEdge>65536||!Number.isFinite(value.quality)||value.quality<1||value.quality>100)throw new RangeError('Invalid export size, format or quality');
 if(!['strip-all','copyright-only','preserve-without-location','preserve-all'].includes(value.metadata))throw new TypeError('Invalid metadata privacy policy');
 const w=value.watermark;if(typeof w.enabled!=='boolean'||typeof w.text!=='string'||w.text.length>256||!Number.isFinite(w.opacity)||w.opacity<0||w.opacity>1||!Number.isFinite(w.fontSize)||w.fontSize<1||w.fontSize>1024||!['top-left','top-right','center','bottom-left','bottom-right'].includes(w.position))throw new RangeError('Invalid watermark');
}
export function validatePhotoExportProgress(progress:PhotoExportProgress):void {if(![progress.completed,progress.failed,progress.total].every(n=>Number.isSafeInteger(n)&&n>=0)||progress.completed+progress.failed>progress.total)throw new RangeError('Invalid reported export progress');}
