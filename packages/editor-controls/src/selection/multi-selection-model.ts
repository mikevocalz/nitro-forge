export type SharedValue=string|number|boolean|null;
export interface SelectableObject {
 readonly id:string;readonly label:string;readonly parentId?:string|null;readonly kind?:'object'|'group';
 readonly disabledReason?:string;readonly readOnly?:boolean;
 readonly properties:Readonly<Record<string,SharedValue>>;
}
export interface ObjectSelection {readonly ids:readonly string[];readonly anchorId:string|null}
export type ObjectSelectionMode='replace'|'add'|'subtract'|'toggle'|'intersect';
export interface SelectionModifiers {readonly shift?:boolean;readonly toggle?:boolean}
const validId=(id:string)=>typeof id==='string'&&!!id.trim()&&id.length<=512;
export function validateSelectableObjects(items:readonly SelectableObject[],selection:ObjectSelection):void {
 if(items.length>10000)throw new RangeError('Too many selectable objects');
 const byId=new Map<string,SelectableObject>();let propertyCount=0,propertyCharacters=0;
 for(const item of items){propertyCount+=Object.keys(item.properties).length;for(const [key,value] of Object.entries(item.properties))propertyCharacters+=key.length+(typeof value==='string'?value.length:8);if(propertyCount>50000||propertyCharacters>2000000)throw new RangeError('Selection property budget exceeded');if(!validId(item.id)||byId.has(item.id)||!item.label.trim()||item.label.length>512||item.parentId!=null&&!validId(item.parentId)||item.kind!==undefined&&!['object','group'].includes(item.kind)||item.disabledReason!==undefined&&(!item.disabledReason.trim()||item.disabledReason.length>1024)||Object.keys(item.properties).length>256||Object.entries(item.properties).some(([key,value])=>!validId(key)||!(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=4096||typeof value==='number'&&Number.isFinite(value))))throw new RangeError('Invalid selectable object');byId.set(item.id,item);}
 // The host supplies the displayed hierarchy; reject cycles and missing parents.
 const done=new Set<string>();
 for(const item of items){const path=new Set<string>();let cursor:SelectableObject|undefined=item;while(cursor&&!done.has(cursor.id)){if(path.has(cursor.id))throw new RangeError('Cyclic selection hierarchy');path.add(cursor.id);const parent=cursor.parentId;if(parent!=null){const owner=byId.get(parent);if(!owner||owner.kind!=='group')throw new RangeError('Selection parent must be an available group');cursor=owner;}else cursor=undefined;}for(const id of path)done.add(id);}
 if(selection.ids.length>items.length||new Set(selection.ids).size!==selection.ids.length||selection.ids.some(id=>!byId.has(id))||selection.anchorId!==null&&!byId.has(selection.anchorId))throw new RangeError('Invalid object selection');
}
/** Combines engine/host hit-test results in display order; disabled objects cannot enter a selection. */
export function combineObjectSelection(items:readonly SelectableObject[],selection:ObjectSelection,hits:readonly string[],mode:ObjectSelectionMode,anchorId:string|null=selection.anchorId):ObjectSelection {
 validateSelectableObjects(items,selection);if(!['replace','add','subtract','toggle','intersect'].includes(mode)||hits.length>items.length||new Set(hits).size!==hits.length)throw new RangeError('Invalid selection operation');
 const byId=new Map(items.map(item=>[item.id,item])),hit=new Set(hits);if(hits.some(id=>!byId.has(id))||anchorId!==null&&!byId.has(anchorId))throw new RangeError('Unknown selection target');
 const before=new Set(selection.ids),ids=items.filter(item=>{if(item.disabledReason)return false;const a=before.has(item.id),b=hit.has(item.id);return mode==='replace'?b:mode==='add'?a||b:mode==='subtract'?a&&!b:mode==='toggle'?a!==b:a&&b;}).map(item=>item.id);
 return {ids,anchorId};
}
/** Shift extends from the captured anchor; Ctrl/Cmd toggles, including additive Shift ranges. */
export function pickSelectionObject(items:readonly SelectableObject[],selection:ObjectSelection,id:string,modifiers:SelectionModifiers={}):ObjectSelection {
 validateSelectableObjects(items,selection);const at=items.findIndex(item=>item.id===id);if(at<0)throw new RangeError('Unknown selection target');if(items[at]!.disabledReason)return selection;
 const anchor=selection.anchorId===null?-1:items.findIndex(item=>item.id===selection.anchorId);
 if(modifiers.shift&&anchor>=0){const hits=items.slice(Math.min(at,anchor),Math.max(at,anchor)+1).filter(item=>!item.disabledReason).map(item=>item.id);return combineObjectSelection(items,selection,hits,modifiers.toggle?'add':'replace',selection.anchorId);}
 return combineObjectSelection(items,selection,[id],modifiers.toggle?'toggle':'replace',id);
}
export type SharedPropertyState={kind:'empty'}|{kind:'missing';count:number}|{kind:'mixed';count:number}|{kind:'value';count:number;value:SharedValue};
export function sharedSelectionProperty(items:readonly SelectableObject[],selection:ObjectSelection,key:string):SharedPropertyState {
 validateSelectableObjects(items,selection);if(!validId(key))throw new RangeError('Invalid shared property');const ids=new Set(selection.ids),chosen=items.filter(item=>ids.has(item.id));if(!chosen.length)return {kind:'empty'};
 if(chosen.some(item=>!Object.hasOwn(item.properties,key)))return {kind:'missing',count:chosen.length};
 const value=chosen[0]!.properties[key]!;return chosen.every(item=>Object.is(item.properties[key],value))?{kind:'value',count:chosen.length,value}:{kind:'mixed',count:chosen.length};
}
export function selectionGroupState(items:readonly SelectableObject[],selection:ObjectSelection):{group:boolean;ungroup:boolean;editable:boolean} {
 validateSelectableObjects(items,selection);const byId=new Map(items.map(item=>[item.id,item])),chosen=selection.ids.map(id=>byId.get(id)!);const editable=chosen.length>0&&chosen.every(item=>!item.readOnly&&!item.disabledReason);
 return {editable,group:editable&&chosen.length>=2&&chosen.every(item=>(item.parentId??null)===(chosen[0]!.parentId??null)),ungroup:editable&&chosen.every(item=>item.kind==='group')};
}
