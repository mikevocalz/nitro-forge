/** One ephemeral preview lease; cancellation is delivered to its original host. */
export function createGradientPreviewOwner<T>(){
 let active:{boundary:string;notify:(value:T|undefined)=>void}|undefined;
 let generation=0;
 const clear=(boundary?:string)=>{
  if(active&&boundary!==undefined&&active.boundary!==boundary)return;
  generation++;
  const previous=active;active=undefined;previous?.notify(undefined);
 };
 return {clear,publish(boundary:string,notify:(value:T|undefined)=>void,value:T){
  const request=++generation;
  if(active&&(active.boundary!==boundary||active.notify!==notify)){
   const previous=active;active=undefined;previous.notify(undefined);
   // Host cleanup may synchronously publish or clear a newer owner.
   if(request!==generation)return;
  }
  active={boundary,notify};notify(value);
 }};
}
