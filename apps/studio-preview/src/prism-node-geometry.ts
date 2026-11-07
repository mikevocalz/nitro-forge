import type {ViewTransform} from '@nyc-tron/ui/components/forge/vector/vector-types';
import type {PrismCanvasState} from '../../../packages/prism/src/canvas-cluster';

type Layer=PrismCanvasState['layers'][number];
const multiply=(a:ViewTransform,b:ViewTransform):ViewTransform=>[
 a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],
];
const local=(layer:Layer):ViewTransform=>{
 const t=layer.transform,r=t.rotation*Math.PI/180,a=Math.cos(r)*t.sx,b=Math.sin(r)*t.sx,c=-Math.sin(r)*t.sy,d=Math.cos(r)*t.sy;
 return [a,b,c,d,t.tx+t.ox-a*t.ox-c*t.oy,t.ty+t.oy-b*t.ox-d*t.oy];
};
/** Same parent-to-child affine composition as Prism render.rs, then actual artboard scale. */
export function prismNodeTransform(state:PrismCanvasState,id:number,width:number,height:number):ViewTransform|null{
 const layer=state.layers.find(item=>item.id===id);
 if(!layer||layer.content.type!=='path'||!(width>0&&height>0&&state.width>0&&state.height>0))return null;
 const visited=new Set<number>(),chain:Layer[]=[];
 let item:Layer|undefined=layer;
 while(item){
  if(visited.has(item.id)||item.locked||!item.visible)return null;
  visited.add(item.id);chain.unshift(item);
  if(item.parent===null)break;
  item=state.layers.find(candidate=>candidate.id===item!.parent);
  if(!item)return null;
 }
 let matrix:ViewTransform=[width/state.width,0,0,height/state.height,0,0];
 for(const member of chain)matrix=multiply(matrix,local(member));
 const determinant=matrix[0]*matrix[3]-matrix[1]*matrix[2];
 return matrix.every(Number.isFinite)&&Number.isFinite(determinant)&&Math.abs(determinant)>=1e-12?matrix:null;
}
