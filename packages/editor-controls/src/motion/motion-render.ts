import {assertFrameRate,type FrameRate} from '../timebase.ts';
export interface MotionRenderFormat {readonly id:string;readonly label:string;readonly kind:'video'|'image-sequence';readonly supportsAlpha:boolean}
export interface MotionRenderProfile {readonly id:string;readonly label:string}
export interface MotionRenderSettings {
 readonly compositionId:string;readonly formatId:string;readonly profileId:string;readonly destinationId:string;
 readonly outputName:string;readonly startFrame:number;readonly endFrame:number;readonly frameRate:FrameRate;
 readonly alpha:'none'|'straight'|'premultiplied';readonly framePadding:number;
}
export interface MotionRenderJob {
 readonly id:string;readonly label:string;readonly settings:MotionRenderSettings;
 readonly status:'queued'|'running'|'completed'|'cancelled'|'failed';
 readonly progress:{readonly completedFrames:number;readonly totalFrames:number}|null;
 readonly error?:string;readonly outputLabel?:string;
}
export function validateRenderChoices(choices:readonly {readonly id:string;readonly label:string}[],name:string):void {if(choices.length>2000)throw new RangeError(`${name} choices exceed 2,000`);const ids=new Set<string>();for(const choice of choices){if(!choice.id.trim()||choice.id.length>256||!choice.label.trim()||choice.label.length>512||ids.has(choice.id))throw new TypeError(`Invalid ${name} identities`);ids.add(choice.id);}}
export function validateMotionRenderSettings(value:MotionRenderSettings,allowDraftName=false):void {
 for(const id of [value.compositionId,value.formatId,value.profileId,value.destinationId])if(typeof id!=='string'||!id.trim()||id.length>256)throw new TypeError('Render request requires composition, encoder, output profile and destination identities');
 if(typeof value.outputName!=='string'||value.outputName.length>200||!allowDraftName&&(!value.outputName.trim()||/[\x00-\x1f/\\:*?"<>|]/.test(value.outputName)||value.outputName==='.'||value.outputName==='..'))throw new TypeError('Render output name must be a file stem without a path');
 if(!Number.isSafeInteger(value.startFrame)||!Number.isSafeInteger(value.endFrame)||value.startFrame<0||value.endFrame<value.startFrame||value.endFrame-value.startFrame>10000000||!Number.isInteger(value.framePadding)||value.framePadding<1||value.framePadding>12||!['none','straight','premultiplied'].includes(value.alpha))throw new RangeError('Invalid render frame range, sequence padding or alpha mode');assertFrameRate(value.frameRate);
}
export function validateMotionRenderJobs(jobs:readonly MotionRenderJob[]):void {if(jobs.length>10000)throw new RangeError('Render queue page exceeds 10,000 jobs');const ids=new Set<string>();for(const job of jobs){if(!job.id.trim()||ids.has(job.id)||!job.label.trim()||!['queued','running','completed','cancelled','failed'].includes(job.status))throw new TypeError('Invalid render job');ids.add(job.id);validateMotionRenderSettings(job.settings);const p=job.progress;if(p!==null&&(!Number.isSafeInteger(p.completedFrames)||!Number.isSafeInteger(p.totalFrames)||p.completedFrames<0||p.totalFrames<0||p.completedFrames>p.totalFrames))throw new RangeError('Invalid engine-reported render progress');}}
/** Queue rows remain in place while only adjacent queued jobs trade order. */
export function moveQueuedRenderJob(jobs:readonly MotionRenderJob[],id:string,direction:-1|1):readonly string[] {validateMotionRenderJobs(jobs);if(direction!==-1&&direction!==1)throw new RangeError('Queue direction must be -1 or 1');const index=jobs.findIndex(job=>job.id===id);if(index<0||jobs[index]!.status!=='queued')throw new TypeError('Only an existing queued render can move');let next=index+direction;while(next>=0&&next<jobs.length&&jobs[next]!.status!=='queued')next+=direction;const order=jobs.map(job=>job.id);if(next<0||next>=jobs.length)return order;[order[index],order[next]]=[order[next]!,order[index]!];return order;}
