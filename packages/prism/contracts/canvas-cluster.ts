// Explicit contract against the built, unpublished canvas checkout. No runtime UI dependency.
import type {AlignDistributePanelProps} from '@nitro-forge/editor-controls/canvas/AlignDistributePanel';
import type {TransformOriginHandleProps} from '@nitro-forge/editor-controls/canvas/TransformOriginHandle';
import type {SelectionMarqueeProps} from '@nitro-forge/editor-controls/selection/SelectionMarquee';
import type {MagicSelectionControlsProps,MagicWandCanvasProps} from '@nitro-forge/editor-controls/selection/MagicSelectionControls';
import type {MaskThumbnailAndEditorProps} from '@nitro-forge/editor-controls/layers/MaskThumbnailAndEditor';
import type {ArtboardNavigatorProps} from '@nitro-forge/editor-controls/layers/ArtboardNavigator';
import type {ClipToggleProps} from '@nitro-forge/editor-controls/layers/ClippingMaskControls';
import type {CanvasCompareViewProps} from '@nitro-forge/editor-controls/layers/CanvasCompareView';
import type {PenNodeEditorProps} from '@nitro-forge/editor-controls/vector/PenNodeEditor';
import type {FillStrokeInspectorProps} from '@nitro-forge/editor-controls/vector/FillStrokeInspector';
import type {GradientOnCanvasHandlesProps} from '@nitro-forge/editor-controls/vector/GradientOnCanvasHandles';
import type {ShapeBuilderProps} from '@nitro-forge/editor-controls/vector/ShapeBuilder';
import type {ColorDropCanvasTargetProps} from '@nitro-forge/editor-controls/canvas-tools/ColorDropCanvasTarget';
import type {CanvasRulerProps} from '@nitro-forge/editor-controls/canvas/CanvasRuler';
import type {SnapGridSettingsProps} from '@nitro-forge/editor-controls/canvas/SnapGridSettings';
import type {ReferenceImageBoardProps} from '@nitro-forge/editor-controls/canvas-tools/ReferenceImageBoard';
import type {GestureCustomizationPanelProps} from '@nitro-forge/editor-controls/canvas-tools/GestureCustomizationPanel';
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
