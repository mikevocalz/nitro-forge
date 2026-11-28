import {createStore} from 'zustand/vanilla';
import {normalizePeak,type WaveformPeak} from '../waveform.ts';
export type WaveformResource={kind:'idle'}|{kind:'loading'}|{kind:'ready';peaks:readonly WaveformPeak[]}|{kind:'error';message:string};
const IDLE:WaveformResource=Object.freeze({kind:'idle'});
/** Source peaks only. No native decoder handles or synthetic waveform data enter the cache. */
export function createWaveformCache(){
 const store=createStore(()=>({version:0})),entries=new Map<string,{state:WaveformResource;abort?:AbortController;bytes:number}>(),refs=new Map<string,number>();
 let pending=0,bytes=0;const changed=()=>store.setState(s=>({version:s.version+1}));
 const remove=(key:string)=>{const e=entries.get(key);if(!e)return;entries.delete(key);bytes-=e.bytes;if(e.abort){pending--;e.abort.abort();}};
 return {store,
  get:(key:string):WaveformResource=>entries.get(key)?.state??IDLE,
  retain(key:string){refs.set(key,(refs.get(key)??0)+1);return()=>{const count=(refs.get(key)??1)-1;if(count>0)refs.set(key,count);else{refs.delete(key);if(entries.get(key)?.abort)remove(key);changed();}};},
  request(key:string,load:(signal:AbortSignal)=>Promise<readonly WaveformPeak[]>,retry=false){
   if(!key||key.length>4096)throw new RangeError('Invalid waveform cache key');
   const previous=entries.get(key);if(previous&&(!retry||previous.state.kind!=='error'))return;
   if(pending>=4)return;
   if(previous)remove(key);
   while(entries.size>=64){const oldest=[...entries].find(([id,e])=>!e.abort&&!refs.has(id));if(!oldest)return;remove(oldest[0]);}
   const abort=new AbortController(),entry:{state:WaveformResource;abort?:AbortController;bytes:number}={state:{kind:'loading'},abort,bytes:0};entries.set(key,entry);pending++;changed();
   void Promise.resolve().then(()=>load(abort.signal)).then(peaks=>{
    if(entries.get(key)!==entry||abort.signal.aborted)return;
    if(peaks.length>8192)throw new RangeError('Waveform provider exceeded 8192 bins');
    const normalized=peaks.map(normalizePeak),weight=normalized.length*16;
    while(bytes+weight>4*1024*1024){const oldest=[...entries].find(([id,e])=>id!==key&&!e.abort&&!refs.has(id));if(!oldest)throw new Error('Waveform cache memory budget is in use');remove(oldest[0]);}
    entry.state={kind:'ready',peaks:normalized};entry.bytes=weight;bytes+=weight;
   }).catch(error=>{if(entries.get(key)===entry&&!abort.signal.aborted)entry.state={kind:'error',message:(error instanceof Error?error.message:String(error)).slice(0,1024)};}).finally(()=>{if(entries.get(key)===entry){entry.abort=undefined;pending--;changed();}});
  },
  clear(){for(const key of [...entries.keys()])remove(key);changed();},
  get byteSize(){return bytes;},get pendingCount(){return pending;},
 };
}
export const sharedWaveformCache=createWaveformCache();
let nextLoader=0;const loaderIds=new WeakMap<Function,number>();
export function mediaProviderId(loader:Function){let id=loaderIds.get(loader);if(id===undefined){id=++nextLoader;loaderIds.set(loader,id);}return id;}
