// Explicit contract against the built, unpublished canvas checkout. No runtime UI dependency.
import type {AlignDistributePanelProps} from '@nyc-tron/ui/components/forge/canvas/AlignDistributePanel';
import type {TransformOriginHandleProps} from '@nyc-tron/ui/components/forge/canvas/TransformOriginHandle';
import type {SelectionMarqueeProps} from '@nyc-tron/ui/components/forge/selection/SelectionMarquee';
import type {MagicSelectionControlsProps,MagicWandCanvasProps} from '@nyc-tron/ui/components/forge/selection/MagicSelectionControls';
import type {MaskThumbnailAndEditorProps} from '@nyc-tron/ui/components/forge/layers/MaskThumbnailAndEditor';
import type {ArtboardNavigatorProps} from '@nyc-tron/ui/components/forge/layers/ArtboardNavigator';
import type {ClipToggleProps} from '@nyc-tron/ui/components/forge/layers/ClippingMaskControls';
import type {CanvasCompareViewProps} from '@nyc-tron/ui/components/forge/layers/CanvasCompareView';
import type {PenNodeEditorProps} from '@nyc-tron/ui/components/forge/vector/PenNodeEditor';
import type {FillStrokeInspectorProps} from '@nyc-tron/ui/components/forge/vector/FillStrokeInspector';
import type {GradientOnCanvasHandlesProps} from '@nyc-tron/ui/components/forge/vector/GradientOnCanvasHandles';
import type {ShapeBuilderProps} from '@nyc-tron/ui/components/forge/vector/ShapeBuilder';
import type {ColorDropCanvasTargetProps} from '@nyc-tron/ui/components/forge/canvas-tools/ColorDropCanvasTarget';
import type {CanvasRulerProps} from '@nyc-tron/ui/components/forge/canvas/CanvasRuler';
import type {SnapGridSettingsProps} from '@nyc-tron/ui/components/forge/canvas/SnapGridSettings';
import type {ReferenceImageBoardProps} from '@nyc-tron/ui/components/forge/canvas-tools/ReferenceImageBoard';
import type {GestureCustomizationPanelProps} from '@nyc-tron/ui/components/forge/canvas-tools/GestureCustomizationPanel';
import {PrismCanvasAdapter,canvasClippingRows,canvasPathNodes,type PrismCanvasState} from '../src/canvas-cluster';

// These controls intentionally write host preferences, not imaginary Prism ops.
export type HostPreferences={ruler:Pick<CanvasRulerProps,'onAddGuide'|'onMoveGuide'|'onRemoveGuide'|'onOriginChange'>;
  grid:Pick<SnapGridSettingsProps,'onGridChange'|'onSnapChange'>;
  references:Pick<ReferenceImageBoardProps,'onUpdate'|'onAdd'|'onRemove'>;
  gestures:GestureCustomizationPanelProps};

export async function bindings(a:PrismCanvasAdapter,state:PrismCanvasState){
  const alignment:Pick<AlignDistributePanelProps,'onAlign'|'onDistribute'|'onMoveLayer'>=a.alignment();
  const origin:TransformOriginHandleProps['onSetOrigin']=a.origin('1').onSetOrigin;
  const transform:TransformOriginHandleProps['transform']=state.layers[0]?.transform;
  const selection:Pick<SelectionMarqueeProps,'onSelectRegion'|'onSelectAll'|'onDeselect'|'onInvertSelection'>=a.selection();
  const wand:MagicWandCanvasProps['onMagicWand']=a.selection().onMagicWand;
  const modify:MagicSelectionControlsProps['onModifySelection']=a.selection().onModifySelection;
  const masks:Pick<MaskThumbnailAndEditorProps,'onAddMask'|'onRemoveMask'|'onSetMaskEnabled'|'onInvertMask'|'onRefineMask'|'loadMaskThumbnail'>=a.masks();
  const artboards:Pick<ArtboardNavigatorProps,'onAddArtboard'|'onUpdateArtboard'|'onRemoveArtboard'|'onMoveArtboard'|'loadThumbnail'>=a.artboards();
  const artboardRows:ArtboardNavigatorProps['artboards']=state.artboards.map(b=>({...b,id:String(b.id)}));
  const clipping:Pick<ClipToggleProps,'layers'|'onSetClipped'>={layers:canvasClippingRows(state),onSetClipped:a.layers().onSetClipped};
  const vector=a.vector('1');
  const pen:Pick<PenNodeEditorProps,'onSetPathNode'|'onInsertNode'|'onRemoveNode'|'onSetNodeKind'|'onSetClosed'>=vector;
  const path=state.layers.find(l=>l.content.type==='path')?.content;
  const nodes:PenNodeEditorProps['subpaths']=path?.type==='path'?canvasPathNodes(path.path.subpaths):[];
  const paint:Pick<FillStrokeInspectorProps,'onSetFill'|'onSetStroke'|'onSetFillRule'|'onSetPaintOrder'>=vector;
  const gradient:GradientOnCanvasHandlesProps['onSetFill']=vector.onSetFill;
  const booleans:Pick<ShapeBuilderProps,'onBoolean'|'onSetBooleanOp'|'onRelease'|'onExpand'|'onSelectOperand'>=a.booleans();
  const fill:ColorDropCanvasTargetProps['onFill']=a.colorDrop('1',()=>[255,0,0,255]).onFill;
  const compare:CanvasCompareViewProps['after']={kind:'pixels',raster:await a.renderRegion({x:0,y:0,w:16,h:12,max:8})};
  return {alignment,origin,transform,selection,wand,modify,masks,artboards,artboardRows,clipping,pen,nodes,paint,gradient,booleans,fill,compare};
}
