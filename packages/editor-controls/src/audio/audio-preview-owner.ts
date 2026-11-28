/** A live audio preview is restored through the exact callback/value that began it. */
export function createAudioPreviewOwner<T>(){
 let generation=0;
 let active:{boundary:string;notify:(value:T)=>void;restore:T;identity:unknown}|undefined;
 const clear=(boundary?:string)=>{if(!active){if(boundary===undefined)generation++;return;}if(boundary!==undefined&&active.boundary!==boundary)return;const previous=active;active=undefined;generation++;previous.notify(previous.restore);};
 const detach=(boundary:string)=>{
  if(!active||active.boundary!==boundary)return (_accepted:boolean)=>{};
  const previous=active;active=undefined;const detached=++generation;let settled=false;
  return(accepted:boolean)=>{if(settled)return;settled=true;if(accepted||generation!==detached)return;generation++;previous.notify(previous.restore);};
 };
 return{clear,detach,publish(boundary:string,notify:(value:T)=>void,restore:T,value:T,identity:unknown=notify){
  if(active&&(active.boundary!==boundary||active.identity!==identity)){const before=generation;clear();if(generation!==before+1)return false;}
  if(!active){active={boundary,notify,restore,identity};generation++;}
  const lease=active;lease.notify(value);return active===lease;
 }};
}
/** Queued responders must match the admitted source and geometry. */
export function audioGestureCurrent(admitted:string|null,current:string,disabled:boolean){return admitted!==null&&admitted===current&&!disabled;}

export function audioResponderCurrent(admitted:string|null,current:string,disabled:boolean,admittedGesture:number|null,eventGesture:number){return audioGestureCurrent(admitted,current,disabled)&&admittedGesture!==null&&admittedGesture===eventGesture;}

/** Detach live feedback on release; restore only an actually rejected host operation.
 * Keep sync operations sync inside the existing admission guard. */
export async function commitAudioPreview<T>(previews:ReturnType<typeof createAudioPreviewOwner<T>>,boundary:string,dispatch:(track:(request:()=>unknown)=>unknown)=>unknown):Promise<boolean>{
 const settle=previews.detach(boundary);let acknowledged:boolean|undefined;
 const accept=(value:unknown)=>{acknowledged=value!==false;if(!acknowledged)throw new Error('Audio change was not accepted');return value;};
 const track=(request:()=>unknown)=>{try{const value=request();if(value&&typeof(value as Promise<unknown>).then==='function')return Promise.resolve(value).then(accept,error=>{acknowledged=false;throw error;});return accept(value);}catch(error){acknowledged=false;throw error;}};
 try{const admitted=await dispatch(track);settle(acknowledged??admitted===true);return admitted===true&&acknowledged!==false;}
 catch{settle(acknowledged??false);return false;}
}
