/**
 * Smart guide math for {@linkcode SmartGuides} (B-05): while a layer moves,
 * find where its edges or centre line up with other layers' bounds, and where
 * the gap to a neighbour equals a gap already on the canvas, then pull the
 * move onto the nearest of those. Inputs are document pixels shaped like the
 * engine's `layerBounds` result, so the host passes that result straight in.
 */
import {tidy,validateDocRect,type CanvasAxis,type DocRect} from "./canvas-viewport.ts";

/** One entry of the engine's `layerBounds` result: bounds, or `empty` for a layer with no pixels. */
export type LayerBoundsEntry=
  |{readonly id:string;readonly x:number;readonly y:number;readonly w:number;readonly h:number;readonly corners?:readonly (readonly [number,number])[]}
  |{readonly id:string;readonly empty:true};
/** A bounds entry that has a rectangle. */
export type LayerBounds=Extract<LayerBoundsEntry,{x:number}>;
/** Which part of a rectangle a guide passes through on its axis. */
export type GuideFeature="start"|"center"|"end";
/**
 * An alignment line: x = `value` (a vertical line, `axis` "x") or y = `value`,
 * drawn from `from` to `to` along the other axis so it spans the moving rect
 * and every rect aligned with it.
 */
export interface AlignmentGuide {
  readonly axis:CanvasAxis;
  readonly value:number;
  readonly from:number;
  readonly to:number;
  /** The moving rect's feature on this line. */
  readonly feature:GuideFeature;
  /** Ids of the other layers on this line. */
  readonly targets:readonly string[];
}
/** A measured gap between two rects along `axis`, drawn as a bar at `at` on the cross axis. */
export interface GapMark {
  readonly from:number;
  readonly to:number;
  readonly at:number;
}
/** Equal gaps along one axis: every mark in `gaps` is `gap` long, one of them touching the moving rect. */
export interface SpacingGuide {
  readonly axis:CanvasAxis;
  readonly gap:number;
  readonly gaps:readonly GapMark[];
}
/** Result of {@linkcode computeSmartGuides}. Pass it to `SmartGuides` to draw it. */
export interface SmartGuideResult {
  /** The moving rect after the pull. Commit this (or `dx`/`dy` added to the drag). */
  readonly rect:DocRect;
  readonly dx:number;
  readonly dy:number;
  readonly alignments:readonly AlignmentGuide[];
  readonly spacings:readonly SpacingGuide[];
}
/** Input for {@linkcode computeSmartGuides}. */
export interface SmartGuideInput {
  /** Where the dragged layer (or selection) would be before snapping. */
  readonly moving:DocRect;
  /** Other layers' bounds; entries for the moving layers themselves and `empty` entries are skipped. */
  readonly others:readonly LayerBoundsEntry[];
  /** Ids being moved, left out of `others`. */
  readonly movingIds?:readonly string[];
  /** Screen units per document pixel. */
  readonly zoom:number;
  /** Pull reach in screen units. @default 6 */
  readonly thresholdPx?:number;
  /** Off returns the input unchanged with no guides. @default true */
  readonly enabled?:boolean;
}
/** Default pull reach, screen units. */
export const SMART_GUIDE_THRESHOLD=6;
/** Others considered per drag; beyond this the nearest by centre distance are used. */
export const SMART_GUIDE_MAX_OTHERS=200;
const EPS=0.5;

const featuresOf=(r:DocRect,axis:CanvasAxis)=>{
  const s=axis==="x"?r.x:r.y,size=axis==="x"?r.w:r.h;
  return {start:s,center:s+size/2,end:s+size};
};
const crossOf=(r:DocRect,axis:CanvasAxis)=>axis==="x"?[r.y,r.y+r.h] as const:[r.x,r.x+r.w] as const;
const moved=(r:DocRect,axis:CanvasAxis,d:number):DocRect=>axis==="x"?{...r,x:r.x+d}:{...r,y:r.y+d};

/** Candidate pull for one axis: the smallest offset that aligns a feature, or makes a gap match. */
function bestOffset(moving:DocRect,others:readonly LayerBounds[],axis:CanvasAxis,reach:number):number|undefined{
  let best:number|undefined;
  const consider=(d:number)=>{if(Math.abs(d)<=reach&&(best===undefined||Math.abs(d)<Math.abs(best)))best=d;};
  const mf=featuresOf(moving,axis);
  for(const o of others){
    const of=featuresOf(o,axis);
    for(const m of [mf.start,mf.center,mf.end])for(const t of [of.start,of.center,of.end])consider(t-m);
  }
  for(const d of spacingTargets(moving,others,axis))consider(d);
  return best;
}
/** Rects that share a band with `moving` across `axis`: the ones a gap along `axis` is measured against. */
const inBand=(moving:DocRect,others:readonly LayerBounds[],axis:CanvasAxis)=>{
  const [a,b]=crossOf(moving,axis);
  return others.filter(o=>{const [c,d]=crossOf(o,axis);return c<b&&a<d;});
};
/** Gaps between consecutive non-overlapping rects of a band, in order. */
function bandGaps(rects:readonly DocRect[],axis:CanvasAxis):{a:DocRect;b:DocRect;gap:number}[]{
  const sorted=[...rects].sort((p,q)=>featuresOf(p,axis).start-featuresOf(q,axis).start);
  const out:{a:DocRect;b:DocRect;gap:number}[]=[];
  for(let i=0;i+1<sorted.length;i++){
    const a=sorted[i]!,b=sorted[i+1]!;
    const gap=featuresOf(b,axis).start-featuresOf(a,axis).end;
    if(gap>0)out.push({a,b,gap});
  }
  return out;
}
/** Offsets that would make a gap next to `moving` equal an existing gap, or centre it between its neighbours. */
function spacingTargets(moving:DocRect,others:readonly LayerBounds[],axis:CanvasAxis):number[]{
  const band=inBand(moving,others,axis);
  const mf=featuresOf(moving,axis);
  const before=band.filter(o=>featuresOf(o,axis).end<=mf.center).sort((p,q)=>featuresOf(q,axis).end-featuresOf(p,axis).end)[0];
  const after=band.filter(o=>featuresOf(o,axis).start>=mf.center).sort((p,q)=>featuresOf(p,axis).start-featuresOf(q,axis).start)[0];
  const existing=bandGaps(band,axis).map(g=>g.gap);
  const out:number[]=[];
  if(before)for(const g of existing)out.push(featuresOf(before,axis).end+g-mf.start);
  if(after)for(const g of existing)out.push(featuresOf(after,axis).start-g-mf.end);
  if(before&&after){
    const room=featuresOf(after,axis).start-featuresOf(before,axis).end-(mf.end-mf.start);
    if(room>0)out.push(featuresOf(before,axis).end+room/2-mf.start);
  }
  return out;
}
function alignmentsOn(rect:DocRect,others:readonly LayerBounds[],axis:CanvasAxis):AlignmentGuide[]{
  const mf=featuresOf(rect,axis);
  const out:AlignmentGuide[]=[];
  for(const feature of ["start","center","end"] as const){
    const value=mf[feature];
    const hits=others.filter(o=>{const f=featuresOf(o,axis);return [f.start,f.center,f.end].some(v=>Math.abs(v-value)<EPS);});
    if(!hits.length)continue;
    const spans=[rect,...hits].map(r=>crossOf(r,axis));
    out.push({axis,value:tidy(value),feature,targets:hits.map(h=>h.id),
      from:tidy(Math.min(...spans.map(s=>s[0]))),to:tidy(Math.max(...spans.map(s=>s[1])))});
  }
  return out;
}
function spacingsOn(rect:DocRect,others:readonly LayerBounds[],axis:CanvasAxis):SpacingGuide[]{
  const band=inBand(rect,others,axis);
  const all=bandGaps([...band,rect],axis);
  const touching=all.filter(g=>g.a===rect||g.b===rect);
  const out:SpacingGuide[]=[];
  for(const t of touching){
    const same=all.filter(g=>Math.abs(g.gap-t.gap)<EPS);
    if(same.length<2)continue;
    if(out.some(s=>Math.abs(s.gap-t.gap)<EPS))continue;
    out.push({axis,gap:tidy(t.gap),gaps:same.map(g=>{
      const [a0,a1]=crossOf(g.a,axis),[b0,b1]=crossOf(g.b,axis);
      const lo=Math.max(a0,b0),hi=Math.min(a1,b1);
      return {from:tidy(featuresOf(g.a,axis).end),to:tidy(featuresOf(g.b,axis).start),at:tidy(lo<hi?(lo+hi)/2:(a0+a1)/2)};
    })});
  }
  return out;
}
/**
 * Pulls `moving` onto the nearest alignment or equal-spacing position on each
 * axis within reach, then reports every alignment line and equal gap the
 * pulled rect has. The rect is moved, never resized.
 */
export function computeSmartGuides({moving,others,movingIds=[],zoom,thresholdPx=SMART_GUIDE_THRESHOLD,enabled=true}:SmartGuideInput):SmartGuideResult{
  validateDocRect(moving,"Moving rectangle");
  if(!Number.isFinite(zoom)||zoom<=0)throw new RangeError(`Canvas zoom must be a positive number, got ${zoom}`);
  if(!Number.isFinite(thresholdPx)||thresholdPx<0)throw new RangeError("Smart guide threshold must be a finite, non-negative number");
  if(others.length>50000||movingIds.length>50000)throw new RangeError('Smart guide input exceeds the 50000-layer budget');
  const ids=new Set<string>();
  for(const entry of others){if(!entry.id.trim()||entry.id.length>512||ids.has(entry.id))throw new RangeError('Smart guide layers need unique bounded IDs');ids.add(entry.id);if(!('empty' in entry))validateDocRect(entry,'Smart guide bounds');}
  if(movingIds.some(id=>!id.trim()||id.length>512))throw new RangeError('Invalid moving layer identity');
  if(!enabled)return {rect:moving,dx:0,dy:0,alignments:[],spacings:[]};
  const skip=new Set(movingIds);
  const cx=moving.x+moving.w/2,cy=moving.y+moving.h/2;
  const rects=others.filter((o):o is LayerBounds=>!("empty" in o)&&!skip.has(o.id));
  for(const r of rects)validateDocRect(r,`Bounds of ${r.id}`);
  const near=rects.length>SMART_GUIDE_MAX_OTHERS
    ?[...rects].sort((a,b)=>Math.hypot(a.x+a.w/2-cx,a.y+a.h/2-cy)-Math.hypot(b.x+b.w/2-cx,b.y+b.h/2-cy)).slice(0,SMART_GUIDE_MAX_OTHERS)
    :rects;
  const reach=thresholdPx/zoom;
  const dx=bestOffset(moving,near,"x",reach)??0;
  const afterX=moved(moving,"x",dx);
  const dy=bestOffset(afterX,near,"y",reach)??0;
  const rect={...moving,x:tidy(moving.x+dx),y:tidy(moving.y+dy)};
  return {rect,dx:tidy(dx),dy:tidy(dy),
    alignments:[...alignmentsOn(rect,near,"x"),...alignmentsOn(rect,near,"y")],
    spacings:[...spacingsOn(rect,near,"x"),...spacingsOn(rect,near,"y")]};
}
/**
 * Spoken summary of what the moving layer lines up with, e.g.
 * "Left edge aligned with Logo. Equal spacing, 24 px". `names` maps ids to
 * layer names; unknown ids read as "another layer".
 */
export function smartGuideSummary(result:SmartGuideResult,names:Readonly<Record<string,string>>={}):string|undefined{
  validateSmartGuideResult(result);
  const featureName=(g:AlignmentGuide)=>g.axis==="x"
    ?{start:"Left edge",center:"Horizontal center",end:"Right edge"}[g.feature]
    :{start:"Top edge",center:"Vertical center",end:"Bottom edge"}[g.feature];
  const parts=result.alignments.map(g=>`${featureName(g)} aligned with ${g.targets.slice(0,3).map(t=>Object.hasOwn(names,t)?String(names[t]).slice(0,128):"another layer").join(", ")+(g.targets.length>3?` and ${g.targets.length-3} others`:"")}`);
  for(const s of result.spacings)parts.push(`Equal ${s.axis==="x"?"horizontal":"vertical"} spacing, ${s.gap} px`);
  return parts.length?parts.join(". "):undefined;
}

/** Validate externally supplied feedback before allocating native overlay views. */
export function validateSmartGuideResult(result:SmartGuideResult):void{
 validateDocRect(result.rect,'Smart guide result');
 if(![result.dx,result.dy].every(Number.isFinite)||result.alignments.length>6||result.spacings.length>4)throw new RangeError('Invalid smart guide feedback budget');
 for(const g of result.alignments){
  if(!['x','y'].includes(g.axis)||!['start','center','end'].includes(g.feature)||![g.value,g.from,g.to].every(Number.isFinite)||g.to<g.from||g.targets.length>SMART_GUIDE_MAX_OTHERS||new Set(g.targets).size!==g.targets.length||g.targets.some(id=>!id.trim()||id.length>512))throw new RangeError('Invalid alignment feedback');
 }
 for(const g of result.spacings){
  if(!['x','y'].includes(g.axis)||!Number.isFinite(g.gap)||g.gap<0||g.gaps.length>SMART_GUIDE_MAX_OTHERS+1||g.gaps.some(m=>![m.from,m.to,m.at].every(Number.isFinite)||m.to<m.from))throw new RangeError('Invalid spacing feedback');
 }
}
