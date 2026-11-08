import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
export interface DraftPoint{id:number;x:number;y:number;locked:boolean}
/** Named entity grouping; layer 0 is implicit, reserved and never serialized in `layers`. */
export interface DraftLayer{id:number;name:string;color:[number,number,number,number]|null;visible:boolean;locked:boolean}
export interface DraftSegment{id:number;a:number;b:number;name:string;color:[number,number,number,number];width:number;visible:boolean;locked:boolean;layer?:number}
export interface DraftCircle extends Omit<DraftSegment,'a'|'b'>{center:number;radius:number}
export interface DraftArc extends DraftCircle{start_deg:number;sweep_deg:number}
export type ConstraintDefinition={kind:'fixed';point:number;x:number;y:number}|{kind:'coincident';a:number;b:number}|{kind:'horizontal'|'vertical';segment:number}|{kind:'distance_x'|'distance_y';a:number;b:number;value:number};
export interface DraftConstraint{id:number;enabled:boolean;definition:ConstraintDefinition}
/** Explicit world-space boundary loops (outer + holes via even-odd), resolved once at write time; not entity references. Line-pattern segment endpoints clip to the boundary while stroke width may extend width/2 past it. */
export type DraftHatchLoops=Array<Array<[number,number]>>;
/** Built-in patterns only: `solid` fills; `ansi31`/`crosshatch`/`horizontal` are bounded line families. */
export type DraftHatchPattern='solid'|'ansi31'|'crosshatch'|'horizontal';
export interface DraftHatch{id:number;name:string;pattern:DraftHatchPattern;color:[number,number,number,number];angle:number;scale:number;width:number;visible:boolean;locked:boolean;layer?:number;loops:DraftHatchLoops}
/** Associative dimension kinds: `linear` needs `axis` ('x'|'y'), point kinds take `points` ids, `radial`/`diameter` take a circle/arc `entity` id. Measured geometry is derived per read, never stored; there is no text/glyph backend so numeric labels are not rendered. */
export type DraftDimensionKind='linear'|'aligned'|'angular'|'radial'|'diameter';
export type DraftDimensionAxis='x'|'y';
export interface DraftDimension{id:number;kind:DraftDimensionKind;points:number[];entity?:number;axis?:DraftDimensionAxis;name:string;color:[number,number,number,number];width:number;visible:boolean;locked:boolean;layer?:number}
/** Derived world-space annotation strokes (extension lines, dimension line, arrowhead legs, angle rays/arc polyline); `value` is world units or degrees, `null` only for a degenerate angular anchor. */
export interface DraftDimensionMeasured{value:number|null;lines:Array<[[number,number],[number,number]]>}
/** `evaluate` projection of a dimension: authored fields plus read-derived status and measured geometry. Orphaned dimensions (references deleted after writes) keep authored refs with `measured:null`. */
export interface DraftDimensionState extends DraftDimension{status:'linked'|'orphaned';measured:DraftDimensionMeasured|null}
export interface SnapSettings{grid:boolean;spacing:number;origin_x:number;origin_y:number;endpoint:boolean;midpoint:boolean;projection:boolean;intersection:boolean;ortho:boolean;polar:boolean;polar_increment:number;center:boolean;nearest_circle:boolean;tangent:boolean}
export interface DraftState{kind:'draft';schema:1;units:'mm'|'cm'|'m'|'in';next_id:number;points:Record<string,DraftPoint>;segments:Record<string,DraftSegment>;circles:Record<string,DraftCircle>;arcs:Record<string,DraftArc>;order:number[];constraints:Record<string,DraftConstraint>;snaps:SnapSettings;layers?:Record<string,DraftLayer>;hatches?:Record<string,DraftHatch>;dimensions?:Record<string,DraftDimension>}
export interface SolveReport{scope:'point_coordinates';status:'solved'|'underconstrained'|'inconsistent';rank:number;dof:number;residual:number;unsatisfied_constraints:number[];unsatisfied_locked_points:number[];applied:boolean}
export interface SnapResult{kind:'grid'|'endpoint'|'midpoint'|'projection'|'intersection'|'ortho'|'polar'|'center'|'nearest_circle'|'tangent';x:number;y:number;distance:number;sources:number[];angle_degrees?:number}
export interface DraftSnapQuery{candidate:SnapResult|null;source_revision:number}
export interface DraftProfileBounds{min_x:number;min_y:number;max_x:number;max_y:number}
export interface DraftProfile{loops:number[][];area:number;centroid:{x:number;y:number};bounds:DraftProfileBounds}
export interface DraftProfiles{profiles:DraftProfile[];source_revision:number}
/** World origin at output pixel (0,0); positive uniform scale is pixels per world unit. */
export interface DraftViewport{width:number;height:number;origin_x:number;origin_y:number;scale:number}
/** No screen transforms, selection, nonlinear constraints or 3D ownership. */
export class DraftDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,units:DraftState['units']='mm'){return new DraftDocument(await DocumentHandle.openInitialized(host,'draft',doc=>doc.apply('new',{units})));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new DraftDocument(await DocumentHandle.openSnapshot(host,'draft',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<DraftState&{source_revision:number}>('describe',{});}
 addPoint(x:number,y:number,locked=false){return this.document.apply<{point_id:number}>('addPoint',{x,y,locked});}
 updatePoint(id:number,patch:Partial<Pick<DraftPoint,'x'|'y'|'locked'>>){return this.document.apply<{ok:boolean}>('updatePoint',{...patch,id});}
 removePoint(id:number){return this.document.apply<{ok:boolean}>('removePoint',{id});}
 addSegment(a:number,b:number,options:Partial<Pick<DraftSegment,'name'|'color'|'width'|'visible'|'locked'|'layer'>>={}){return this.document.apply<{segment_id:number}>('addSegment',{...options,a,b});}
 updateSegment(id:number,patch:Partial<Omit<DraftSegment,'id'>>){return this.document.apply<{ok:boolean}>('updateSegment',{...patch,id});}
 removeSegment(id:number){return this.document.apply<{ok:boolean}>('removeSegment',{id});}
 setSegmentOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setSegmentOrder',{order});}
 addCircle(center:number,radius:number,options:Partial<Pick<DraftCircle,'name'|'color'|'width'|'visible'|'locked'|'layer'>>={}){return this.document.apply<{circle_id:number}>('addCircle',{...options,center,radius});}
 addArc(center:number,radius:number,start_deg:number,sweep_deg:number,options:Partial<Pick<DraftArc,'name'|'color'|'width'|'visible'|'locked'|'layer'>>={}){return this.document.apply<{arc_id:number}>('addArc',{...options,center,radius,start_deg,sweep_deg});}
 updateCircle(id:number,patch:Partial<Omit<DraftCircle,'id'>>){return this.document.apply<{ok:boolean}>('updateCircle',{...patch,id});}
 updateArc(id:number,patch:Partial<Omit<DraftArc,'id'>>){return this.document.apply<{ok:boolean}>('updateArc',{...patch,id});}
 removeCircle(id:number){return this.document.apply<{ok:boolean}>('removeCircle',{id});}
 removeArc(id:number){return this.document.apply<{ok:boolean}>('removeArc',{id});}
 setEntityOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setEntityOrder',{order});}
 /** Layer 0 is implicit and reserved; named layers carry visibility/lock for their entities. */
 addLayer(name:string,options:Partial<Pick<DraftLayer,'color'|'visible'|'locked'>>={}){return this.document.apply<{layer_id:number}>('addLayer',{name,...options});}
 updateLayer(id:number,patch:Partial<Omit<DraftLayer,'id'>>){return this.document.apply<{ok:boolean}>('updateLayer',{...patch,id});}
 /** Rejects while any segment/circle/arc/hatch still references the layer. */
 removeLayer(id:number){return this.document.apply<{ok:boolean}>('removeLayer',{id});}
 /** Exactly one boundary source: explicit `loops` or `boundary_ids` (closed segment/circle/arc loops, traced once; `tolerance` applies only to `boundary_ids`; later entity edits do not move the hatch). Hatches composite beneath entity strokes and paint among themselves in id order. */
 addHatch(options:{loops:DraftHatchLoops}|{boundary_ids:number[]},patch:Partial<Pick<DraftHatch,'name'|'pattern'|'color'|'angle'|'scale'|'width'|'visible'|'locked'|'layer'>>&{tolerance?:number}={}){return this.document.apply<{hatch_id:number}>('addHatch',{...patch,...options});}
 updateHatch(id:number,patch:Partial<Omit<DraftHatch,'id'|'loops'>>&{loops?:DraftHatchLoops|{boundary_ids:number[];tolerance?:number}}){const{loops,...rest}=patch;const boundary=loops&&'boundary_ids' in loops?{boundary_ids:loops.boundary_ids,...(loops.tolerance!==undefined?{tolerance:loops.tolerance}:{})}:loops!==undefined?{loops}:{};return this.document.apply<{ok:boolean}>('updateHatch',{...rest,...boundary,id});}
 removeHatch(id:number){return this.document.apply<{ok:boolean}>('removeHatch',{id});}
 /** Associative dimension: `points` are 2 point ids (linear/aligned) or 3 (angular vertex,first,second); `entity` is a circle/arc id for radial/diameter; `axis` is required for linear and rejected elsewhere. Writes require every reference to resolve; deleting referenced geometry later orphans the dimension (status `orphaned`, no measured geometry, no rendered strokes). */
 addDimension(options:{kind:DraftDimensionKind;points?:number[];entity?:number;axis?:DraftDimensionAxis}&Partial<Pick<DraftDimension,'name'|'color'|'width'|'visible'|'locked'|'layer'>>){return this.document.apply<{dimension_id:number}>('addDimension',options);}
 updateDimension(id:number,patch:Partial<Omit<DraftDimension,'id'>>){return this.document.apply<{ok:boolean}>('updateDimension',{...patch,id});}
 removeDimension(id:number){return this.document.apply<{ok:boolean}>('removeDimension',{id});}
 setSnapSettings(patch:Partial<SnapSettings>){return this.document.apply<{ok:boolean}>('setSnapSettings',patch);}
 /** Tolerance is world units; the host converts any screen tolerance with its actual viewport. */
 querySnap(x:number,y:number,tolerance:number,anchor?:{x:number;y:number}){return this.document.apply<DraftSnapQuery>('querySnap',{x,y,tolerance,...(anchor?{anchor}:{})});}
 /** One bounded supported command, reusing the same atomic model operations. */
 executeCommand(command:string){return this.document.apply<{message:string;result:unknown}>('executeCommand',{command});}
 addConstraint(definition:ConstraintDefinition,enabled=true){return this.document.apply<{constraint_id:number}>('addConstraint',{definition,enabled});}
 updateConstraint(id:number,patch:{definition?:ConstraintDefinition;enabled?:boolean}){return this.document.apply<{ok:boolean}>('updateConstraint',{...patch,id});}
 removeConstraint(id:number){return this.document.apply<{ok:boolean}>('removeConstraint',{id});}
 /** Publishes only a consistent bounded solution; unconstrained coordinates retain their authored value. */
 solve(tolerance=1e-7){return this.document.apply<SolveReport>('solve',{tolerance});}
 /** Read-only deterministic closed-loop tracing; tolerance is world units (default 1e-6). */
 findProfiles(tolerance?:number){return this.document.apply<DraftProfiles>('findProfiles',tolerance===undefined?{}:{tolerance});}
 evaluate(){return this.document.apply<Pick<DraftState,'points'|'segments'|'circles'|'arcs'|'hatches'|'order'>&{dimensions:Record<string,DraftDimensionState>;source_revision:number}>('evaluate',{});}
 renderFrame(viewport:DraftViewport){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',viewport);}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}

export {bindDraftingCommandLine,bindDraftingSnaps,DRAFT_COMMAND_COMPLETIONS,DRAFT_SNAP_MODES} from './cad-bindings';
export type {DraftCommandHost,DraftCommandBinding,DraftSnapHost,DraftSnapBinding} from './cad-bindings';
