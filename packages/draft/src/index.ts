import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';
export interface DraftPoint{id:number;x:number;y:number;locked:boolean}
export interface DraftSegment{id:number;a:number;b:number;name:string;color:[number,number,number,number];width:number;visible:boolean;locked:boolean}
export type ConstraintDefinition={kind:'fixed';point:number;x:number;y:number}|{kind:'coincident';a:number;b:number}|{kind:'horizontal'|'vertical';segment:number}|{kind:'distance_x'|'distance_y';a:number;b:number;value:number};
export interface DraftConstraint{id:number;enabled:boolean;definition:ConstraintDefinition}
export interface SnapSettings{grid:boolean;spacing:number;origin_x:number;origin_y:number;endpoint:boolean;midpoint:boolean;projection:boolean;intersection:boolean}
export interface DraftState{kind:'draft';schema:1;units:'mm'|'cm'|'m'|'in';next_id:number;points:Record<string,DraftPoint>;segments:Record<string,DraftSegment>;order:number[];constraints:Record<string,DraftConstraint>;snaps:SnapSettings}
export interface SolveReport{status:'solved'|'underconstrained'|'inconsistent';rank:number;dof:number;residual:number;unsatisfied_constraints:number[];unsatisfied_locked_points:number[];applied:boolean}
export interface SnapResult{kind:'grid'|'endpoint'|'midpoint'|'projection'|'intersection';x:number;y:number;distance:number;sources:number[]}
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
 setSnapSettings(patch:Partial<SnapSettings>){return this.document.apply<{ok:boolean}>('setSnapSettings',patch);}
 /** Tolerance is world units; the host converts any screen tolerance with its actual viewport. */
 querySnap(x:number,y:number,tolerance:number){return this.document.apply<{candidate:SnapResult|null;source_revision:number}>('querySnap',{x,y,tolerance});}
 addConstraint(definition:ConstraintDefinition,enabled=true){return this.document.apply<{constraint_id:number}>('addConstraint',{definition,enabled});}
 updateConstraint(id:number,patch:{definition?:ConstraintDefinition;enabled?:boolean}){return this.document.apply<{ok:boolean}>('updateConstraint',{...patch,id});}
 removeConstraint(id:number){return this.document.apply<{ok:boolean}>('removeConstraint',{id});}
 /** Publishes only a consistent bounded solution; unconstrained coordinates retain their authored value. */
 solve(tolerance=1e-7){return this.document.apply<SolveReport>('solve',{tolerance});}
 evaluate(){return this.document.apply<Pick<DraftState,'points'|'segments'|'order'>&{source_revision:number}>('evaluate',{});}
 renderFrame(viewport:DraftViewport){return this.document.apply<{width:number;height:number;pixels_b64?:string}>('renderFrame',viewport);}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}
