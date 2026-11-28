import {useLayoutEffect,useRef} from 'react';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';

/** Document identity for controlled editor tools. Native handles remain outside UI state. */
export interface ScopedControlProps {scope?:string;revision?:string|number;disabledReason?:string|undefined}
export function controlIdentity(scope:string,revision:string|number){
 if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid control identity');
 return [scope,revision] as const;
}

/** Admit one host operation and invalidate handlers at the committed boundary. */
export function useScopedControl<P>(boundary:string,props:P,disabled=false){
 const action=useOwnedAction(boundary),pending=action.pending!==null;
 const committed=useRef<{boundary:string;props:P;disabled:boolean}|null>(null);
 const admitted=useRef<symbol|null>(null);
 useLayoutEffect(()=>{committed.current={boundary,props,disabled};});
 useLayoutEffect(()=>{admitted.current=null;},[boundary]);
 useLayoutEffect(()=>()=>{committed.current=null;},[]);
 const current=()=>{const p=committed.current;return p&&p.boundary===boundary&&!p.disabled&&!pending&&!admitted.current?p.props:null;};
 const run=(id:string,operation:(props:P,signal:AbortSignal)=>unknown|Promise<unknown>)=>{
  const p=current();if(!p)return;
  const token=Symbol(id);admitted.current=token;
  return action.run(id,signal=>operation(p,signal),undefined,{pendingForAsyncOnly:true}).finally(()=>{if(admitted.current===token)admitted.current=null;});
 };
 const cancel=()=>{if(committed.current?.boundary!==boundary)return false;admitted.current=null;action.cancel();return true;};
 return {current,run,cancel,pending,pendingId:action.pending,error:action.error};
}
