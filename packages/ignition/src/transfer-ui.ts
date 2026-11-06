import {runExport,runImport,type ExportFormat,type ImportFormat,type ExportResult} from './transfer';
import type {DocumentHandle} from './document';

/** Explicit platform delivery selected by the transfer UI. */
export type TransferDestination='files'|'share'|'download';
/** Host-visible status; progress is absent when the underlying operation cannot measure it. */
export type TransferUiStatus={readonly kind:'idle'}|{readonly kind:'working'}|{readonly kind:'done';readonly message?:string}|{readonly kind:'error';readonly message:string};
/** Maps actual engine formats to the controlled export sheet, with no unsupported metadata fields. */
export function transferUiFormats(formats:readonly ExportFormat[]){return formats.map(f=>({id:f.id,label:f.label,extension:f.extension,mimeType:f.mime,...(f.quality?{quality:{min:f.quality.min,max:f.quality.max,step:f.quality.step,default:f.quality.defaultValue,unit:f.quality.unit,label:f.quality.label}}:{})}));}
/** Describes actual import formats for the existing platform picker. */
export function transferUiImports(formats:readonly ImportFormat[]){return formats.map(f=>({id:f.id,label:f.label,extensions:[f.extension],mimeTypes:[f.mime]}));}
/** Explicit host boundary: engine returns bytes; the platform writer chooses their destination. */
export interface TransferUiOptions {
 readonly document:DocumentHandle;readonly exports:readonly ExportFormat[];readonly imports:readonly ImportFormat[];
 readonly write:(result:ExportResult,destination:TransferDestination)=>Promise<void>;
 readonly onStatus:(status:TransferUiStatus)=>void;
}
/** One in-flight transfer per binding. Rejections update status and propagate to the host. */
export function createTransferUiBindings(options:TransferUiOptions){
 let busy=false;
 const execute=async(run:()=>Promise<void>)=>{
  if(busy)throw new Error('A transfer is already running');busy=true;
  try{options.onStatus({kind:'working'});await run();options.onStatus({kind:'done'});}
  catch(error){options.onStatus({kind:'error',message:error instanceof Error?error.message:String(error)});throw error;}
  finally{busy=false;}
 };
 return {
  onExport:(request:{formatId:string;filename:string;quality?:number;metadata:Readonly<Record<string,string|boolean>>;destination:TransferDestination})=>execute(async()=>{
   if(Object.keys(request.metadata).length)throw new Error('These export formats do not support metadata');
   const bytes=await runExport(options.document,options.exports,request);await options.write(bytes,request.destination);
  }),
  importBytes:(formatId:string,bytes:Uint8Array)=>execute(()=>runImport(options.document,options.imports,formatId,bytes)),
 };
}
