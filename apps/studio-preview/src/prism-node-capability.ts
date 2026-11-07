/** Require the published cancellation/focus contract before mounting node gestures. */
export function supportsPrismNodeEditing(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;
 const capability=value as Record<string,unknown>;
 return capability.version===1&&capability.scopedInteractions===true&&capability.geometryCancellation===true&&capability.stableGeometryFocus===true;
}
