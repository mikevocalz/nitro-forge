import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
export interface DraftPoint{id:number;x:number;y:number;locked:boolean}
export interface DraftSegment{id:number;a:number;b:number;name:string;color:[number,number,number,number];width:number;visible:boolean;locked:boolean}
export interface DraftCircle extends Omit<DraftSegment,'a'|'b'>{center:number;radius:number}
export interface DraftArc extends DraftCircle{start_deg:number;sweep_deg:number}
export type ConstraintDefinition={kind:'fixed';point:number;x:number;y:number}|{kind:'coincident';a:number;b:number}|{kind:'horizontal'|'vertical';segment:number}|{kind:'distance_x'|'distance_y';a:number;b:number;value:number};
export interface DraftConstraint{id:number;enabled:boolean;definition:ConstraintDefinition}
export interface SnapSettings{grid:boolean;spacing:number;origin_x:number;origin_y:number;endpoint:boolean;midpoint:boolean;projection:boolean;intersection:boolean;ortho:boolean;polar:boolean;polar_increment:number;center:boolean;nearest_circle:boolean;tangent:boolean}
export interface DraftState{kind:'draft';schema:1;units:'mm'|'cm'|'m'|'in';next_id:number;points:Record<string,DraftPoint>;segments:Record<string,DraftSegment>;circles:Record<string,DraftCircle>;arcs:Record<string,DraftArc>;order:number[];constraints:Record<string,DraftConstraint>;snaps:SnapSettings}
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
 addSegment(a:number,b:number,options:Partial<Pick<DraftSegment,'name'|'color'|'width'|'visible'|'locked'>>={}){return this.document.apply<{segment_id:number}>('addSegment',{...options,a,b});}
 updateSegment(id:number,patch:Partial<Omit<DraftSegment,'id'>>){return this.document.apply<{ok:boolean}>('updateSegment',{...patch,id});}
 removeSegment(id:number){return this.document.apply<{ok:boolean}>('removeSegment',{id});}
 setSegmentOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setSegmentOrder',{order});}
 addCircle(center:number,radius:number,options:Partial<Pick<DraftCircle,'name'|'color'|'width'|'visible'|'locked'>>={}){return this.document.apply<{circle_id:number}>('addCircle',{...options,center,radius});}
 addArc(center:number,radius:number,start_deg:number,sweep_deg:number,options:Partial<Pick<DraftArc,'name'|'color'|'width'|'visible'|'locked'>>={}){return this.document.apply<{arc_id:number}>('addArc',{...options,center,radius,start_deg,sweep_deg});}
 updateCircle(id:number,patch:Partial<Omit<DraftCircle,'id'>>){return this.document.apply<{ok:boolean}>('updateCircle',{...patch,id});}
 updateArc(id:number,patch:Partial<Omit<DraftArc,'id'>>){return this.document.apply<{ok:boolean}>('updateArc',{...patch,id});}
 removeCircle(id:number){return this.document.apply<{ok:boolean}>('removeCircle',{id});}
 removeArc(id:number){return this.document.apply<{ok:boolean}>('removeArc',{id});}
 setEntityOrder(order:readonly number[]){return this.document.apply<{ok:boolean}>('setEntityOrder',{order});}
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
 evaluate(){return this.document.apply<Pick<DraftState,'points'|'segments'|'circles'|'arcs'|'order'>&{source_revision:number}>('evaluate',{});}
 renderFrame(viewport:DraftViewport){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',viewport);}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}

export {bindDraftingCommandLine,bindDraftingSnaps,DRAFT_COMMAND_COMPLETIONS,DRAFT_SNAP_MODES} from './cad-bindings';
export type {DraftCommandHost,DraftCommandBinding,DraftSnapHost,DraftSnapBinding} from './cad-bindings';
