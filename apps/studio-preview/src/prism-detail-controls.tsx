import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {Banner,Button,List,ListItem,Select,TabBar,Text,View} from '@nitro-forge/studio-workspace/ui';
import {resolveWorkspaceScale,workspaceThemes,type WorkspaceDensity} from '@nitro-forge/studio-workspace/theme';
import {AlignDistributePanel} from '@nyc-tron/ui/components/forge/canvas/AlignDistributePanel';
import {ArtboardNavigator} from '@nyc-tron/ui/components/forge/layers/ArtboardNavigator';
import {ClipToggle} from '@nyc-tron/ui/components/forge/layers/ClippingMaskControls';
import {MaskThumbnailAndEditor} from '@nyc-tron/ui/components/forge/layers/MaskThumbnailAndEditor';
import {MagicSelectionControls} from '@nyc-tron/ui/components/forge/selection/MagicSelectionControls';
import {ForegroundBackgroundChips} from '@nyc-tron/ui/components/forge/color/ForegroundBackgroundChips';
import {SwatchGrid} from '@nyc-tron/ui/components/forge/color/SwatchGrid';
import {ColorPickerDialog} from '@nyc-tron/ui/components/forge/color/ColorPickerDialog';
import {PrecisionScrubber} from '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber';
import {rgbToHsv,hsvToRgb,type HsvColor} from '@nyc-tron/ui/components/forge/color';
import type {AlignReferenceKind,DistributeMode} from '@nyc-tron/ui/components/forge/canvas/align-distribute-model';
import type {PrismDocument} from '../../../packages/prism/src/index';
import {PrismCanvasAdapter,canvasClippingRows,type PrismCanvasState} from '../../../packages/prism/src/canvas-cluster';
import {bindPrismColors,readPrismColors,type PrismColorBinding,type ColorSlot,type ColorValue,toEngineColor,commitPrismFill} from '../../../packages/prism/src/color-cluster';

export interface PrismDetailControlsProps {
 document:PrismDocument;
 state:PrismCanvasState;
 /** Optional primary layer focus shared with the existing canvas/layers host. */
 selectedLayerId?:number|null;
 onSelectLayer?:(id:number)=>void;
 disabled:boolean;
 /** Parent owns source admission and one lock shared with header/editor operations. */
 commit:(write:()=>Promise<unknown>)=>Promise<void>;
 theme:'dark'|'light';
 density:WorkspaceDensity;
 /** Optional real viewport reveal; an artboard is not a route or window dimension. */
 onSelectArtboard?:(id:string)=>void;
}
const observed=<T,>(task:Promise<T>)=>{void task.catch(()=>{});return task;};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Supported document controls only. No renderer, native session or engine handle is created. */
export function PrismDetailControls(props:PrismDetailControlsProps){
 const {document,state,disabled,commit}=props,scale=resolveWorkspaceScale(props.density),colors=workspaceThemes[props.theme];
 const adapter=useMemo(()=>new PrismCanvasAdapter(document),[document]);
 const store=useMemo(()=>createStore(()=>({panel:'objects' as 'objects'|'selection'|'artboards'|'colors',layerId:null as number|null,artboardId:undefined as string|undefined,
  reference:'canvas' as AlignReferenceKind,distribution:'centers' as DistributeMode,spacing:undefined as number|undefined,
  refine:{feather:0,grow:0},radii:{grow:1,feather:1,smooth:1},wand:{tolerance:32,contiguous:true,sample:'composite' as 'composite'|'layer'},
  active:'foreground' as ColorSlot,query:'',palette:null as PrismColorBinding|null,hasSelection:false,readStatus:'idle' as 'idle'|'loading'|'ready'|'error',readError:'',retry:0,
  picker:null as {session:number;slot:ColorSlot;original:HsvColor;draft:HsvColor}|null,session:0})),[document]);
 const view=useStore(store,s=>s),propertyLayerId=props.selectedLayerId===undefined?view.layerId:props.selectedLayerId;
 const layer=props.selectedLayerId===null?undefined:state.layers.find(item=>item.id===propertyLayerId)??state.layers[0];
 const board=state.artboards.find(item=>String(item.id)===view.artboardId);
 const identity=JSON.stringify([view.panel,layer?.id,board?.id,view.active,view.picker?.session]);
 const context=useRef({document,state,disabled,identity,generation:0});
 if(context.current.document!==document||context.current.state!==state||context.current.disabled!==disabled||context.current.identity!==identity)
  context.current={document,state,disabled,identity,generation:context.current.generation+1};
 const generation=context.current.generation,readSource=useRef(-1),mounted=useRef(false),pickerOwner=useRef<{document:PrismDocument;state:PrismCanvasState;session:number}|null>(null);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const live=()=>mounted.current&&context.current.generation===generation;
 const current=()=>live()&&!context.current.disabled;
 const select=(patch:Partial<ReturnType<typeof store.getState>>)=>{if(!live())return;context.current.generation++;store.setState(patch);};
 const write=(action:()=>Promise<unknown>)=>current()?observed(commit(action)):observed(Promise.reject(new Error('The selected image controls changed. Wait for the current document.')));
 const key=JSON.stringify([identity,generation]);
 useEffect(()=>{
  let active=true;readSource.current=-1;
  if(disabled||!['objects','selection','colors'].includes(view.panel))return;
  store.setState({readStatus:'loading',readError:''});
  const load=async()=>view.panel==='colors'?{palette:await readPrismColors(document)}:{hasSelection:!('empty' in (await document.getSelection()).data)};
  void load().then(value=>{if(active&&current()){readSource.current=generation;store.setState({...value,readStatus:'ready'});}},error=>{
   if(active&&current()){readSource.current=generation;store.setState({readStatus:'error',readError:message(error)});}
  });
  return()=>{active=false;};
 },[document,state,disabled,identity,generation,view.retry,store]);
 const readReady=readSource.current===generation&&view.readStatus==='ready';
 const preview=async(id:string,max:number,kind:'mask'|'artboard')=>{
  if(!current())throw new Error('Preview source changed.');
  const pixels=await(kind==='mask'?adapter.masks().loadMaskThumbnail(id,max):adapter.artboards().loadThumbnail(id,max));
  if(!current())throw new Error('Preview source changed.');
  return pixels;
 };
 const selection=adapter.selection(),masks=adapter.masks(),alignment=adapter.alignment(),boards=adapter.artboards();
 const selected=state.layers.filter(item=>state.selected.includes(item.id));
 const selectedObject=selected.length===1?selected[0]:undefined;
 const siblingLayers=selectedObject?state.layers.filter(item=>item.parent===selectedObject.parent):[];
 const stack=selectedObject?{index:siblingLayers.findIndex(item=>item.id===selectedObject.id),count:siblingLayers.length}:undefined;
 const numeric=(label:string,value:number,min:number,max:number,step:number,unit:string,run:(next:number)=>Promise<unknown>)=><PrecisionScrubber key={key+label} label={label} value={value} min={Math.min(min,value)} max={Math.max(max,value)} step={step} unit={unit} disabled={disabled||!!layer?.locked}
  {...{targetSize:scale.size.target}} onCommit={next=>write(()=>run(next))}/>;
 const colorActions=bindPrismColors(document,()=>{}),palette=readReady?view.palette:null;
 const groups=palette?[{id:'recent',label:'Recent document colors',kind:'recent' as const,swatches:palette.recent.map((color,index)=>({id:String(index),color}))}]:[];
 const openColor=()=>{if(!palette||!current())return;const original=rgbToHsv(palette.pair[view.active]);pickerOwner.current={document,state,session:view.session+1};select({session:view.session+1,picker:{session:view.session+1,slot:view.active,original,draft:original}});};
 const commitColor=(slot:ColorSlot,color:ColorValue)=>write(()=>colorActions.commit(slot,color));
 const picker=view.picker&&pickerOwner.current?.document===document&&pickerOwner.current.state===state&&pickerOwner.current.session===view.picker.session?view.picker:null;
 const selectObject=(id:number)=>{const next=state.selected.includes(id)?state.selected.filter(value=>value!==id):[...state.selected,id];return write(()=>adapter.layers().select(next));};
 return <View testID="prism-detail-controls" style={{gap:scale.space.group}}>
  <TabBar semantics="tabs" density="compact" aria-label="Image detail panels" tabs={(['objects','selection','artboards','colors'] as const).map(panel=>({key:panel,label:panel==='objects'?'Objects':panel==='selection'?'Selection':panel==='artboards'?'Artboards':'Colors',icon:null,active:view.panel===panel,onPress:()=>select({panel,picker:null})}))}/>
  {view.readStatus==='error'&&readSource.current===generation&&<Banner tone="danger" title={view.readError} live="alert"/>}
  {view.readStatus==='error'&&readSource.current===generation&&<Button title="Retry image data" disabled={disabled} targetSize={scale.size.target} onPress={()=>store.setState(s=>({retry:s.retry+1}))}/>}
  {view.panel==='objects'&&<>
   {!layer?<Text style={{color:colors.muted}}>Create a layer to edit object properties.</Text>:<>
    <Select label="Layer properties" value={String(layer.id)} options={state.layers.map(item=>({value:String(item.id),label:item.name}))} disabled={disabled}
     onValueChange={id=>{if(!current())return;select({layerId:Number(id),refine:{feather:0,grow:0}});props.onSelectLayer?.(Number(id));}}/>
    <Button title={layer.locked?'Unlock layer':'Lock layer'} targetSize={scale.size.target} disabled={disabled} variant="ghost" onPress={()=>{void write(()=>adapter.layers().setLocked(layer.id,!layer.locked));}}/>
    {!disabled&&!layer.locked&&<ClipToggle key={key+'clip'} layers={canvasClippingRows(state)} layerId={String(layer.id)} onSetClipped={request=>write(()=>adapter.layers().onSetClipped(request))}/> }
    {numeric('Layer X',layer.transform.tx,-1000000,1000000,.1,' px',tx=>document.setLayerTransform(layer.id,{tx}))}
    {numeric('Layer Y',layer.transform.ty,-1000000,1000000,.1,' px',ty=>document.setLayerTransform(layer.id,{ty}))}
    {numeric('Layer rotation',layer.transform.rotation,-36000,36000,.1,'°',rotation=>document.setLayerTransform(layer.id,{rotation}))}
    {!disabled&&readReady&&<MaskThumbnailAndEditor key={key+'mask'} layerId={String(layer.id)} layerName={layer.name} locked={layer.locked}
     mask={layer.mask?{enabled:layer.mask.enabled,inverted:layer.mask.inverted,revision:generation}:null} hasSelection={readReady&&view.hasSelection}
     loadMaskThumbnail={(id,max)=>preview(id,max,'mask')} refineDraft={view.refine} onRefineDraftChange={refine=>{if(current())store.setState({refine});}}
     onAddMask={request=>write(()=>masks.onAddMask(request))} onRemoveMask={request=>write(()=>masks.onRemoveMask(request))}
     onSetMaskEnabled={request=>write(()=>masks.onSetMaskEnabled(request))} onInvertMask={request=>write(()=>masks.onInvertMask(request))}
     onRefineMask={request=>{const task=write(()=>masks.onRefineMask(request));void task.then(()=>{if(mounted.current&&context.current.document===document&&context.current.identity===identity)store.setState({refine:{feather:0,grow:0}});}).catch(()=>{});return task;}}/>}
    {!disabled&&!readReady&&<Text style={{color:colors.muted}}>Mask controls wait for the current pixel selection.</Text>}
   </>}
  </>}
  {view.panel==='selection'&&<>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:scale.space.element}}>
    <Button title="Select all pixels" disabled={disabled} targetSize={scale.size.target} onPress={()=>{void write(selection.onSelectAll);}}/>
    <Button title="Deselect pixels" disabled={disabled||!readReady||!view.hasSelection} targetSize={scale.size.target} variant="ghost" onPress={()=>{void write(selection.onDeselect);}}/>
    <Button title="Invert pixel selection" disabled={disabled} targetSize={scale.size.target} variant="ghost" onPress={()=>{void write(selection.onInvertSelection);}}/>
   </View>
   <MagicSelectionControls key={key+'edges'} settings={view.wand} onSettingsChange={wand=>{if(current())store.setState({wand});}} currentLayerName={layer?.name}
    hasSelection={!disabled&&readReady&&view.hasSelection} radii={view.radii} onRadiiChange={radii=>{if(current())store.setState({radii});}} onModifySelection={request=>write(()=>selection.onModifySelection(request))}/>
   <Text style={{color:colors.muted}}>Object selection for alignment</Text>
   <List>{state.layers.map(item=><ListItem key={item.id} selected={state.selected.includes(item.id)} onPress={()=>{if(!disabled)void selectObject(item.id);}}>{item.name}</ListItem>)}</List>
   <AlignDistributePanel key={key+'align'} items={selected.map(item=>({id:String(item.id),name:item.name,locked:item.locked}))} reference={view.reference}
    onReferenceChange={reference=>select({reference})} {...(board?{artboard:{id:String(board.id),name:board.name}}:{})} onAlign={request=>write(()=>alignment.onAlign(request))}
    distributeMode={view.distribution} onDistributeModeChange={distribution=>select({distribution})} spacing={view.spacing} onSpacingChange={spacing=>{if(current())store.setState({spacing});}}
    onDistribute={request=>write(()=>alignment.onDistribute(request))} {...(selected.length===1&&stack?{stack}:{})} onMoveLayer={request=>write(()=>alignment.onMoveLayer(request))} disabled={disabled}/>
  </>}
  {view.panel==='artboards'&&!disabled&&<ArtboardNavigator key={key+'boards'} artboards={state.artboards.map(item=>({...item,id:String(item.id),revision:generation}))}
   {...(board?{selectedId:String(board.id)}:{})} onSelect={id=>{if(!current()||!state.artboards.some(board=>String(board.id)===id))return;select({artboardId:id});props.onSelectArtboard?.(id);}}
   onAddArtboard={request=>write(()=>boards.onAddArtboard(request))} onUpdateArtboard={request=>write(()=>boards.onUpdateArtboard(request))}
   onRemoveArtboard={request=>write(()=>boards.onRemoveArtboard(request))} onMoveArtboard={request=>write(()=>boards.onMoveArtboard(request))}
   loadThumbnail={(id,max)=>preview(id,max,'artboard')}/>}
  {view.panel==='colors'&&<>
   {!palette?<Text accessibilityLiveRegion="polite" style={{color:colors.muted}}>{view.readStatus==='error'&&readSource.current===generation?'Document colors are unavailable. Retry above.':'Loading document colors…'}</Text>:<>
    <ForegroundBackgroundChips key={key+'pair'} value={palette.pair} active={view.active} onActiveChange={active=>select({active,picker:null})} disabled={disabled}
     onCommit={pair=>write(()=>document.setColors({foreground:toEngineColor(pair.foreground),background:toEngineColor(pair.background),remember:false}))}/>
    <Button title={`Edit ${view.active} color`} targetSize={scale.size.target} disabled={disabled} onPress={openColor}/>
    <SwatchGrid groups={groups} query={view.query} onQueryChange={query=>{if(current())store.setState({query});}} disabled={disabled} onSelect={swatch=>commitColor(view.active,swatch.color)}/>
    {layer&&['shape','path','boolean','raster'].includes(layer.content.type)&&<Button title="Apply foreground to layer" disabled={disabled||layer.locked} targetSize={scale.size.target} onPress={()=>{void write(()=>layer.content.type==='raster'?document.fillLayer(layer.id,toEngineColor(palette.pair.foreground)):commitPrismFill(document,layer.id,palette.pair.foreground));}}/>}
    <Button title="Clear recent document colors" variant="ghost" disabled={disabled||!palette.recent.length} targetSize={scale.size.target} onPress={()=>{void write(colorActions.clearRecent);}}/>
   </>}
   {picker&&!disabled&&<ColorPickerDialog key={key+String(picker.session)} visible original={picker.original} value={picker.draft}
    target={picker.slot} onValueChange={draft=>{if(current())store.setState(s=>s.picker?.session===picker.session?{picker:{...s.picker,draft}}:{});}} onCancel={()=>{if(current()&&store.getState().picker?.session===picker.session)select({picker:null});}}
    onCommit={hsv=>{const task=commitColor(picker.slot,hsvToRgb(hsv));void task.then(()=>{if(mounted.current&&context.current.document===document&&store.getState().picker?.session===picker.session)store.setState({picker:null});}).catch(()=>{});return task;}}/>}
  </>}
 </View>;
}
