import type {DraftDocument,DraftState,DraftSnapQuery} from './index';
/** Matches the current canonical command-line control. Input/history remain host-owned. */
export interface DraftCommandBinding{
 prompt:string;history:readonly {id:string;command:string;output:string;kind:'result'|'error'|'info'}[];
 completions:typeof DRAFT_COMMAND_COMPLETIONS;busy:boolean;
 onInput:(text:string)=>void;onExecute:(command:string,signal?:AbortSignal)=>Promise<{message:string;result:unknown}>;onCancel:()=>unknown;
}
export interface DraftCommandHost{
 history:DraftCommandBinding['history'];busy:boolean;
 /** Current document-session ownership; perform owns source/readiness admission. */
 isCurrent:()=>boolean;
 perform:(action:()=>Promise<unknown>)=>Promise<void>;
 onInput:(text:string)=>void;onCancel:()=>unknown;
 recordHistory:(entry:{command:string;output:string;kind:'result'|'error'})=>void;
}
export const DRAFT_COMMAND_COMPLETIONS=[
 {id:'point',label:'POINT x y',replacement:'POINT '},{id:'line',label:'LINE x1 y1 x2 y2',replacement:'LINE '},
 {id:'circle',label:'CIRCLE centerX centerY radius',replacement:'CIRCLE '},{id:'arc',label:'ARC centerX centerY radius startDegrees sweepDegrees',replacement:'ARC '},
 {id:'segment',label:'SEGMENT pointIdA pointIdB',replacement:'SEGMENT '},{id:'move',label:'MOVE pointId x y',replacement:'MOVE '},
 {id:'delete-point',label:'DELETE POINT id',replacement:'DELETE POINT '},{id:'delete-segment',label:'DELETE SEGMENT id',replacement:'DELETE SEGMENT '},
 {id:'delete-circle',label:'DELETE CIRCLE id',replacement:'DELETE CIRCLE '},{id:'delete-arc',label:'DELETE ARC id',replacement:'DELETE ARC '},
 {id:'delete-constraint',label:'DELETE CONSTRAINT id',replacement:'DELETE CONSTRAINT '},{id:'solve',label:'SOLVE [tolerance]',replacement:'SOLVE'},
 {id:'snap',label:'SNAP x y tolerance [anchorX anchorY]',replacement:'SNAP '},
 {id:'layer-new',label:'LAYER NEW name',replacement:'LAYER NEW '},{id:'layer-rename',label:'LAYER RENAME id name',replacement:'LAYER RENAME '},
 {id:'layer-visible',label:'LAYER VISIBLE id on|off',replacement:'LAYER VISIBLE '},{id:'layer-lock',label:'LAYER LOCK id on|off',replacement:'LAYER LOCK '},
 {id:'layer-delete',label:'LAYER DELETE id',replacement:'LAYER DELETE '},{id:'delete-layer',label:'DELETE LAYER id',replacement:'DELETE LAYER '},
 {id:'hatch',label:'HATCH pattern id [id...] (boundary entity ids)',replacement:'HATCH '},{id:'delete-hatch',label:'DELETE HATCH id',replacement:'DELETE HATCH '},
 {id:'dim-linear',label:'DIM LINEAR a b x|y',replacement:'DIM LINEAR '},{id:'dim-aligned',label:'DIM ALIGNED a b',replacement:'DIM ALIGNED '},
 {id:'dim-angular',label:'DIM ANGULAR vertex first second',replacement:'DIM ANGULAR '},{id:'dim-radial',label:'DIM RADIAL entity',replacement:'DIM RADIAL '},
 {id:'dim-diameter',label:'DIM DIAMETER entity',replacement:'DIM DIAMETER '},{id:'delete-dimension',label:'DELETE DIMENSION id',replacement:'DELETE DIMENSION '},
] as const;
/** Errors reject so the canonical editor retains its draft; no simulated geometry or optimistic history. */
export function bindDraftingCommandLine(document:Pick<DraftDocument,'executeCommand'>,host:DraftCommandHost):DraftCommandBinding{
 if(host.history.length>1000||new Set(host.history.map(h=>h.id)).size!==host.history.length||host.history.some(h=>h.command.length>8192||h.output.length>65536))throw new RangeError('Command history exceeds its bounded host window');
 return {prompt:'2D drafting command',history:host.history,completions:DRAFT_COMMAND_COMPLETIONS,busy:host.busy,
  onInput:text=>{if(host.isCurrent())host.onInput(text);},onCancel:()=>{if(host.isCurrent())return host.onCancel();},
  onExecute:async(command,signal)=>{
   if(command.length>8192)throw new RangeError('Command input exceeds the control boundary');
   if(!host.isCurrent()||host.busy||signal?.aborted)throw new Error('Command is unavailable for the current document');
   try{
    let result:Awaited<ReturnType<DraftDocument['executeCommand']>>|undefined;
    await host.perform(async()=>{if(!host.isCurrent()||signal?.aborted)throw new Error('Command cancelled before dispatch');result=await document.executeCommand(command);return result;});
    if(!result)throw new Error('Command owner did not execute the operation');
    if(host.isCurrent())host.recordHistory({command,output:result.data.message+' '+JSON.stringify(result.data.result),kind:'result'});
    return result.data;
   }catch(error){if(host.isCurrent())host.recordHistory({command,output:error instanceof Error?error.message:String(error),kind:'error'});throw error;}
  },
 };
}
export const DRAFT_SNAP_MODES=[{id:'endpoint',label:'Endpoint',available:true},{id:'midpoint',label:'Midpoint',available:true},{id:'projection',label:'Finite-segment projection',available:true},{id:'intersection',label:'Unique finite intersection',available:true},{id:'center',label:'Circle/arc center',available:true},{id:'nearest_circle',label:'Closest circle/arc point',available:true},{id:'tangent',label:'Tangent from world anchor',available:false}] as const;
interface CanonicalSettings{ortho:boolean;polar:boolean;polarIncrement:number;grid:boolean;gridSpacing:number;enabled:Readonly<Record<string,boolean>>}
export interface DraftSnapHost<Feedback>{
 state:DraftState;sourceRevision:number;query:DraftSnapQuery;anchorAvailable?:boolean;isCurrent:()=>boolean;
 perform:(action:()=>Promise<unknown>)=>Promise<void>;
 /** The caller supplies its real viewport feedback; this binding creates no second canvas. */
 renderFeedback:()=>Feedback;
}
export interface DraftSnapBinding<Feedback>{settings:CanonicalSettings;modes:readonly {id:typeof DRAFT_SNAP_MODES[number]['id'];label:string;available:boolean}[];candidate:{kind:string;label:string;world:readonly[number,number,number];distance:number}|null;renderFeedback:()=>Feedback;onCommit:(settings:CanonicalSettings,signal?:AbortSignal)=>Promise<void>}
export function bindDraftingSnaps<Feedback>(document:Pick<DraftDocument,'setSnapSettings'>,host:DraftSnapHost<Feedback>):DraftSnapBinding<Feedback>{
 if(!Number.isSafeInteger(host.sourceRevision)||host.sourceRevision<0)throw new RangeError('Invalid authoritative source revision');
 const s=host.state.snaps,candidate=host.isCurrent()&&host.query.source_revision===host.sourceRevision?host.query.candidate:null;
 return{settings:{ortho:s.ortho,polar:s.polar,polarIncrement:s.polar_increment,grid:s.grid,gridSpacing:s.spacing,enabled:{endpoint:s.endpoint,midpoint:s.midpoint,projection:s.projection,intersection:s.intersection,center:s.center??false,nearest_circle:s.nearest_circle??false,tangent:s.tangent??false}},modes:DRAFT_SNAP_MODES.map(mode=>mode.id==='tangent'?{...mode,available:host.anchorAvailable===true}:mode),
  candidate:candidate?{kind:candidate.kind,label:candidate.angle_degrees===undefined?candidate.kind:`${candidate.kind} ${candidate.angle_degrees}°`,world:[candidate.x,candidate.y,0],distance:candidate.distance}:null,
  renderFeedback:host.renderFeedback,
  onCommit:async(settings,signal)=>{if(!host.isCurrent()||signal?.aborted)throw new Error('Drafting settings are unavailable for the current document');if(Object.keys(settings.enabled).some(id=>!DRAFT_SNAP_MODES.some(mode=>mode.id===id)))throw new RangeError('Unsupported snap mode');
   await host.perform(()=>{if(!host.isCurrent()||signal?.aborted)throw new Error('Drafting settings cancelled before dispatch');return document.setSnapSettings({ortho:settings.ortho,polar:settings.polar,polar_increment:settings.polarIncrement,grid:settings.grid,spacing:settings.gridSpacing,endpoint:settings.enabled.endpoint??false,midpoint:settings.enabled.midpoint??false,projection:settings.enabled.projection??false,intersection:settings.enabled.intersection??false,center:settings.enabled.center??false,nearest_circle:settings.enabled.nearest_circle??false,tangent:settings.enabled.tangent??false});});
  },
 };
}
