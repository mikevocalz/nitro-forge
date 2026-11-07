import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prismNodeTransform} from './prism-node-geometry.ts';
import type {PrismCanvasState} from '../../../packages/prism/src/canvas-cluster';

type Layer=PrismCanvasState['layers'][number];
const layer=(id:number,patch:Partial<Layer>={}):Layer=>({
 id,name:`Layer ${id}`,visible:true,opacity:1,locked:false,blend:'normal',parent:null,clipped:false,mask:null,
 transform:{tx:0,ty:0,sx:1,sy:1,rotation:0,ox:0,oy:0},
 content:{type:'path',path:{subpaths:[{closed:false,nodes:[{x:1,y:2},{x:4,y:5}]}],fill:null,stroke:null,fill_rule:'nonzero',paint_order:'fill-stroke'}},...patch,
});
const doc=(layers:readonly Layer[]):PrismCanvasState=>({width:200,height:100,next_id:10,selected:[],artboards:[],layers});
function maps(state:PrismCanvasState,id:number,width:number,height:number,point:readonly[number,number],expected:readonly[number,number]){
 const m=prismNodeTransform(state,id,width,height);
 assert.ok(m);
 const result=[m[0]*point[0]+m[2]*point[1]+m[4],m[1]*point[0]+m[3]*point[1]+m[5]];
 result.forEach((value,index)=>assert.ok(Math.abs(value-expected[index]!)<1e-9,`${result} != ${expected}`));
 // The canonical inverse must recover the original content point, including mirrored axes.
 const determinant=m[0]*m[3]-m[1]*m[2],x=result[0]!-m[4],y=result[1]!-m[5];
 assert.ok(Math.abs((m[3]*x-m[2]*y)/determinant-point[0])<1e-9);
 assert.ok(Math.abs((-m[1]*x+m[0]*y)/determinant-point[1])<1e-9);
}

test('maps pivoted rotated nonuniform mirrored path through nested groups and actual viewport',()=>{
 const state=doc([
  layer(3,{parent:2,transform:{tx:5,ty:6,sx:-2,sy:3,rotation:90,ox:1,oy:2}}),
  layer(1,{content:{type:'group'},transform:{tx:10,ty:20,sx:2,sy:1,rotation:90,ox:0,oy:0}}),
  layer(2,{parent:1,content:{type:'group'},transform:{tx:3,ty:-4,sx:1,sy:3,rotation:0,ox:2,oy:1}}),
 ]);
 // Explicit engine formula: path (4,5)->(-3,2), inner->(0,0), outer->(10,20).
 maps(state,3,400,200,[4,5],[20,40]);
 // Pivot point (1,2)->(6,8), inner->(9,18), outer->(-8,38).
 maps(state,3,400,200,[1,2],[-16,76]);
 // Do not replace measured height with width-derived scaling.
 maps(state,3,400,300,[1,2],[-16,114]);
});

test('rejects singular/nonfinite layer transforms and unusable measured dimensions',()=>{
 for(const transform of [{sx:0},{sy:0},{tx:Infinity},{rotation:NaN},{ox:Infinity}]){
  const source=layer(1);assert.equal(prismNodeTransform(doc([{...source,transform:{...source.transform,...transform}}]),1,200,100),null);
 }
 for(const [w,h] of [[0,100],[-1,100],[200,0],[Infinity,100],[200,NaN]])assert.equal(prismNodeTransform(doc([layer(1)]),1,w!,h!),null);
 assert.equal(prismNodeTransform({...doc([layer(1)]),width:0},1,200,100),null);
});

test('rejects unavailable paths and unavailable ancestor chains',()=>{
 for(const patch of [{locked:true},{visible:false}]){
  assert.equal(prismNodeTransform(doc([layer(1,patch)]),1,200,100),null);
  assert.equal(prismNodeTransform(doc([layer(1,{parent:2}),layer(2,{content:{type:'group'},...patch})]),1,200,100),null);
 }
 assert.equal(prismNodeTransform(doc([layer(1,{parent:2})]),1,200,100),null);
 assert.equal(prismNodeTransform(doc([layer(1,{parent:2}),layer(2,{parent:1,content:{type:'group'}})]),1,200,100),null);
 assert.equal(prismNodeTransform(doc([layer(1,{content:{type:'group'}})]),1,200,100),null);
 assert.equal(prismNodeTransform(doc([layer(1)]),999,200,100),null);
});
