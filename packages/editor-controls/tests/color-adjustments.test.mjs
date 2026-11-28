import test from 'node:test';import assert from 'node:assert/strict';
import {validateCurve,moveCurvePoint,evaluateCurve,validateLevels,poolHistogram,poolScope,validateGrade,validateHSLSecondary} from '../src/color/color-adjustments.ts';
import {validateMesh,editMeshPoint,rasterizeMesh} from '../src/color/gradient-mesh.ts';
const curve={interpolation:'monotone',points:[{id:'black',x:0,y:0},{id:'mid',x:.5,y:.7},{id:'white',x:1,y:1}]};
test('curves preserve endpoint inputs, point identities and ordered neighbors',()=>{
 validateCurve(curve);const next=moveCurvePoint(curve,'mid',1,.8);assert.ok(next.points[1].x<1);assert.equal(next.points[1].y,.8);assert.equal(curve.points[1].y,.7);
 assert.equal(moveCurvePoint(curve,'black',.25,.1).points[0].x,0);assert.throws(()=>validateCurve({...curve,points:[curve.points[0],{...curve.points[1],x:0},curve.points[2]]}),/increase/);
 assert.throws(()=>validateCurve({...curve,points:curve.points.map(p=>({...p,id:'same'}))}),/distinct/);
});
test('linear/monotone interpolation retains endpoints and never overshoots segment extrema',()=>{
 assert.equal(evaluateCurve(curve,0),0);assert.equal(evaluateCurve(curve,1),1);assert.equal(evaluateCurve(curve,.5),.7);
 assert.equal(evaluateCurve({...curve,interpolation:'linear'},.25),.35);
 for(const ys of [[0,.9,.2,1],[.5,.5,.5,.5],[1,.8,.1,0]]){
  const c={interpolation:'monotone',points:ys.map((y,i)=>({id:String(i),x:i/3,y}))};for(let i=0;i<=300;i++){const x=i/300,y=evaluateCurve(c,x),j=Math.min(2,Math.floor(x*3));assert.ok(y>=Math.min(ys[j],ys[j+1])-1e-12&&y<=Math.max(ys[j],ys[j+1])+1e-12);}
 }
 assert.throws(()=>evaluateCurve(curve,NaN),RangeError);
});
test('histogram pooling retains total counts including sparse and non-divisible bins',()=>{
 for(const length of [0,1,3,257,1000]){const bins=Array.from({length},(_,i)=>i%7);const pooled=poolHistogram(bins,128);assert.equal(pooled.reduce((a,b)=>a+b,0),bins.reduce((a,b)=>a+b,0));assert.ok(pooled.length<=128);}
 assert.throws(()=>poolHistogram([NaN]),RangeError);assert.throws(()=>poolHistogram([-1]),RangeError);
});
test('scope pooling includes edge samples and preserves actual sample intensity',()=>{
 const pooled=poolScope([{x:0,y:0,intensity:.25},{x:1,y:1,intensity:.5},{x:1,y:1,intensity:.25}],4);assert.equal(pooled[0],.25);assert.equal(pooled[15],.75);assert.equal(pooled.reduce((a,b)=>a+b,0),1);assert.throws(()=>poolScope([{x:1.1,y:.5,intensity:1}]),RangeError);
});
test('levels and grading reject impossible bounds and nonfinite exposure',()=>{
 const levels={inputBlack:0,inputWhite:1,gamma:1,outputBlack:0,outputWhite:1};validateLevels(levels);assert.throws(()=>validateLevels({...levels,inputBlack:1}),RangeError);assert.throws(()=>validateLevels({...levels,gamma:0}),RangeError);
 const band={hue:0,saturation:0,exposureEv:0},grade={shadows:band,midtones:band,highlights:band,balance:0,blend:1};validateGrade(grade);assert.throws(()=>validateGrade({...grade,shadows:{...band,exposureEv:Infinity}}),RangeError);
});
test('secondary hue wraps across zero while saturation/luma remain ordered',()=>{
 const value={enabled:true,hueStart:340,hueEnd:20,hueFeather:10,saturationMin:0,saturationMax:1,luminanceMin:0,luminanceMax:1,softness:.1,denoise:0,hueShift:0,saturationShift:0,luminanceShift:0,showMask:false,invert:false};validateHSLSecondary(value);assert.throws(()=>validateHSLSecondary({...value,saturationMin:.9,saturationMax:.1}),/ordered/);
});
const color={r:20,g:100,b:200,alpha:1};const mesh={rows:2,columns:2,points:[{id:'a',x:0,y:0,color},{id:'b',x:1,y:0,color},{id:'c',x:0,y:1,color},{id:'d',x:1,y:1,color}]};
test('mesh edits preserve grid identity and reject folded or singular cells',()=>{
 validateMesh(mesh);const next=editMeshPoint(mesh,'a',{x:.1,y:.1});assert.equal(next.points[0].x,.1);assert.equal(mesh.points[0].x,0);assert.throws(()=>editMeshPoint(mesh,'a',{x:1,y:1}),/fold|collapse/);assert.throws(()=>validateMesh({...mesh,rows:3}),/grid/);assert.throws(()=>editMeshPoint(mesh,'missing',{x:.2}),/Unknown/);
});

test('bilinear mesh display preview preserves corner colors, smooth intermediate values and premultiplied alpha',()=>{
 const colors=[{r:255,g:0,b:0,alpha:1},{r:0,g:255,b:0,alpha:1},{r:0,g:0,b:255,alpha:1},{r:255,g:255,b:255,alpha:0}];const m={...mesh,points:mesh.points.map((p,i)=>({...p,color:colors[i]}))};const raster=rasterizeMesh(m,9),pixel=(x,y)=>[...raster.pixels.slice((y*9+x)*4,(y*9+x)*4+4)];
 assert.deepEqual(pixel(0,0),[255,0,0,255]);assert.deepEqual(pixel(8,0),[0,255,0,255]);assert.deepEqual(pixel(4,4),[85,85,85,191]);assert.deepEqual(pixel(8,8),[0,0,0,0]);assert.throws(()=>rasterizeMesh(m,1024),RangeError);
});
