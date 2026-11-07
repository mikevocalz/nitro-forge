import {useLayoutEffect,useMemo,useRef,type ComponentType} from 'react';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import * as PenNodeModule from '@nyc-tron/ui/components/forge/vector/PenNodeEditor';
import type {PenNodeEditorProps} from '@nyc-tron/ui/components/forge/vector/PenNodeEditor';
import {supportsPrismNodeEditing} from './prism-node-capability';
import type {NodeRef} from '@nyc-tron/ui/components/forge/vector/vector-types';
import type {PrismDocument} from '../../../packages/prism/src/index';
import {PrismCanvasAdapter,canvasPathNodes,type PrismCanvasState} from '../../../packages/prism/src/canvas-cluster';

import {prismNodeTransform} from './prism-node-geometry';
export {prismNodeTransform} from './prism-node-geometry';

/** Reflective access keeps alpha.4's absent optional export a supported fallback. */
export const PRISM_NODE_EDITING_SUPPORTED=supportsPrismNodeEditing(Reflect.get(PenNodeModule,'PEN_NODE_EDITOR_CAPABILITIES'));
const ScopedPenNodeEditor=PenNodeModule.PenNodeEditor as ComponentType<PenNodeEditorProps&{scope:string;revision:number;disabledReason?:string}>;
let nextNodeScope=0;

export function PrismNodeOverlay(props:{document:PrismDocument;state:PrismCanvasState;layerId:number;width:number;height:number;color:string;disabled:boolean;commit:(write:()=>Promise<unknown>)=>Promise<void>}){
 const {document,state,layerId,width,height,disabled,commit}=props;
 const scope=useMemo(()=>`prism-path-${++nextNodeScope}-${layerId}`,[document,layerId]);
 const source=useRef({document,state,revision:0});
 if(source.current.document!==document||source.current.state!==state)source.current={document,state,revision:source.current.revision+1};
 const adapter=useMemo(()=>new PrismCanvasAdapter(document),[document]);
 const store=useMemo(()=>createStore(()=>({node:undefined as NodeRef|undefined})),[document,layerId]);
 const node=useStore(store,value=>value.node),mounted=useRef(false);
 const authority=useRef({document,state,layerId,width,height,disabled,generation:0});
 const prior=authority.current;
 if(prior.document!==document||prior.state!==state||prior.layerId!==layerId||prior.width!==width||prior.height!==height||prior.disabled!==disabled)
  authority.current={document,state,layerId,width,height,disabled,generation:prior.generation+1};
 const generation=authority.current.generation,current=()=>mounted.current&&authority.current.generation===generation&&!authority.current.disabled;
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const layer=state.layers.find(item=>item.id===layerId),transform=prismNodeTransform(state,layerId,width,height);
 if(!PRISM_NODE_EDITING_SUPPORTED||!transform||layer?.content.type!=='path')return null;
 const vector=adapter.vector(layerId),paths=canvasPathNodes(layer.content.path.subpaths);
 const selection=node&&paths[node.subpath]?.nodes[node.index]?node:undefined;
 const write=(action:()=>Promise<unknown>)=>current()?commit(action):Promise.reject(new Error('The canvas changed. Try the edit again.'));
 return <ScopedPenNodeEditor scope={scope} revision={source.current.revision} {...(disabled?{disabledReason:'Wait for the current canvas.'}:{})} width={width} height={height} transform={transform} subpaths={paths} selection={selection}
  label={`Edit path nodes: ${layer.name}`} showCommands={false} unstyled accentColor={props.color} style={{position:'absolute',left:0,top:0}}
  onSelectionChange={next=>{if(current())store.setState({node:next});}}
  onSetPathNode={intent=>write(()=>vector.onSetPathNode(intent))}
  onInsertNode={intent=>write(()=>vector.onInsertNode(intent))}
  onRemoveNode={intent=>write(()=>vector.onRemoveNode(intent))}
  onSetNodeKind={intent=>write(()=>vector.onSetNodeKind(intent))}
  onSetClosed={intent=>write(()=>vector.onSetClosed(intent))}/>;
}
