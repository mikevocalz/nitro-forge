import {validateLayers,type LayerRow} from './layer-model.ts';
export interface LayerTreeRow {layer:LayerRow;depth:number;inheritedLock:boolean;hasChildren:boolean}
/** Validate the complete document, including descendants hidden by a collapsed group. */
export function validateLayerTree(layers:readonly LayerRow[]):void {
 validateLayers(layers);const byId=new Map(layers.map(layer=>[layer.id,layer])),done=new Set<string>();
 for(const layer of layers){const path=new Set<string>();let current:LayerRow|undefined=layer;while(current&&!done.has(current.id)){if(path.has(current.id))throw new RangeError('Cyclic layer group');path.add(current.id);if(current.parentId!=null){const parent=byId.get(current.parentId);if(!parent||parent.kind!=='group')throw new RangeError('Layer parent must be a present group');current=parent;}else current=undefined;}for(const id of path)done.add(id);}
}
export function flattenLayerTree(layers:readonly LayerRow[],expandedIds:readonly string[]):LayerTreeRow[] {
 validateLayerTree(layers);const byId=new Map(layers.map(layer=>[layer.id,layer]));if(new Set(expandedIds).size!==expandedIds.length||expandedIds.some(id=>byId.get(id)?.kind!=='group'))throw new RangeError('Invalid layer expansion');
 const children=new Map<string|null,LayerRow[]>();for(const layer of layers){const parent=layer.parentId??null;const list=children.get(parent)??[];list.push(layer);children.set(parent,list);}
 const expanded=new Set(expandedIds),rows:LayerTreeRow[]=[],pending=(children.get(null)??[]).map(layer=>({layer,depth:0,inheritedLock:false})).reverse();
 while(pending.length){const row=pending.pop()!,nested=children.get(row.layer.id)??[];rows.push({...row,hasChildren:nested.length>0});if(expanded.has(row.layer.id))for(let index=nested.length-1;index>=0;index--)pending.push({layer:nested[index]!,depth:row.depth+1,inheritedLock:row.inheritedLock||!!row.layer.locked});}
 return rows;
}
/** Reparent/reorder as one UI intent. Insertion index is among remaining siblings. */
export function validateLayerTreeMove(layers:readonly LayerRow[],id:string,parentId:string|null,toIndex:number):void {
 validateLayerTree(layers);const byId=new Map(layers.map(layer=>[layer.id,layer])),layer=byId.get(id);if(!layer)throw new RangeError('Unknown layer');
 const chain=(start:string|null)=>{let at=start;while(at!==null){const item=byId.get(at);if(!item)throw new RangeError('Unknown parent');if(item.locked)throw new RangeError('A locked group or layer cannot be moved into or out of');if(at===id)throw new RangeError('Cannot move a group into itself or a descendant');at=item.parentId??null;}};
 if(layer.locked)throw new RangeError('Layer is locked');
 // The current parent may be the moving layer's ancestor, but never the layer itself.
 chain(layer.parentId??null);
 if(parentId!==null&&byId.get(parentId)?.kind!=='group')throw new RangeError('Destination must be a group');chain(parentId);
 const count=layers.filter(item=>item.id!==id&&(item.parentId??null)===parentId).length;
 if(!Number.isInteger(toIndex)||toIndex<0||toIndex>count)throw new RangeError('Layer sibling index out of range');
}
/** Optional host state helper; document/engine mutations still belong to the consumer. */
export function moveLayerTree<T extends LayerRow>(layers:readonly T[],id:string,parentId:string|null,toIndex:number):T[] {
 validateLayerTreeMove(layers,id,parentId,toIndex);const moving=layers.find(layer=>layer.id===id)!;const remaining=layers.filter(layer=>layer.id!==id),siblings=remaining.filter(layer=>(layer.parentId??null)===parentId);
 const before=siblings[toIndex],after=siblings.at(-1);const insertion=before?remaining.indexOf(before):after?remaining.indexOf(after)+1:remaining.length;
 return [...remaining.slice(0,insertion),{...moving,parentId},...remaining.slice(insertion)];
}
