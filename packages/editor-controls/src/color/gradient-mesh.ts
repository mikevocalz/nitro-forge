import {assertRgba,type RgbaColor} from "../color.ts";
/** One stable, normalized mesh control point consumed by GradientMeshEditor. */
export interface MeshPoint {readonly id:string;readonly x:number;readonly y:number;readonly color:RgbaColor}
/** Row-major bilinear color mesh. The host owns actual surface rendering. */
export interface GradientMesh {readonly rows:number;readonly columns:number;readonly points:readonly MeshPoint[]}
const cross=(a:MeshPoint,b:MeshPoint,c:MeshPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
/** Rejects folded/singular cells by checking all four bilinear corner Jacobians. */
export function validateMesh(mesh:GradientMesh):void{
 if(![mesh.rows,mesh.columns].every(n=>Number.isInteger(n)&&n>=2&&n<=16)||mesh.points.length!==mesh.rows*mesh.columns)throw new RangeError('Mesh requires a 2..16 by 2..16 row-major grid');
 const ids=new Set<string>();for(const p of mesh.points){if(!p.id||ids.has(p.id))throw new TypeError('Mesh point IDs must be distinct');ids.add(p.id);if(![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw new RangeError('Mesh coordinates must be 0..1');assertRgba(p.color);}
 for(let row=0;row<mesh.rows-1;row++)for(let column=0;column<mesh.columns-1;column++){
  const a=mesh.points[row*mesh.columns+column]!,b=mesh.points[row*mesh.columns+column+1]!,c=mesh.points[(row+1)*mesh.columns+column]!,d=mesh.points[(row+1)*mesh.columns+column+1]!;
  if(Math.min(cross(a,b,c),cross(b,d,a),cross(c,a,d),cross(d,c,b))<=1e-8)throw new RangeError('Mesh movement would fold or collapse a cell');
 }
}
/** Immutable edit; invalid topology leaves the original document unchanged. */
export function editMeshPoint(mesh:GradientMesh,id:string,change:Partial<Pick<MeshPoint,'x'|'y'|'color'>>):GradientMesh{
 validateMesh(mesh);if(!mesh.points.some(p=>p.id===id))throw new TypeError('Unknown mesh point');
 const next={...mesh,points:mesh.points.map(p=>p.id===id?{...p,...change}:p)};validateMesh(next);return next;
}

/**
 * Bounded sRGB display preview of the actual bilinear mesh, including alpha.
 * The host can replace this preview with its color-managed renderer. Each cell
 * uses inverse bilinear coordinates; pixels outside the mesh stay transparent.
 */
export function rasterizeMesh(mesh:GradientMesh,edge=48):{width:number;height:number;pixels:Uint8Array}{
 validateMesh(mesh);
 if(!Number.isInteger(edge)||edge<8||edge>128)throw new RangeError('Mesh preview edge must be 8..128');
 const pixels=new Uint8Array(edge*edge*4);
 for(let row=0;row<mesh.rows-1;row++)for(let column=0;column<mesh.columns-1;column++){
  const a=mesh.points[row*mesh.columns+column]!,b=mesh.points[row*mesh.columns+column+1]!,c=mesh.points[(row+1)*mesh.columns+column]!,d=mesh.points[(row+1)*mesh.columns+column+1]!;
  const ex=b.x-a.x,ey=b.y-a.y,fx=c.x-a.x,fy=c.y-a.y,gx=a.x-b.x-c.x+d.x,gy=a.y-b.y-c.y+d.y;
  const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x,d.x)*(edge-1))),x1=Math.min(edge-1,Math.ceil(Math.max(a.x,b.x,c.x,d.x)*(edge-1)));
  const y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y,d.y)*(edge-1))),y1=Math.min(edge-1,Math.ceil(Math.max(a.y,b.y,c.y,d.y)*(edge-1)));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const px=x/(edge-1),py=y/(edge-1);let u=.5,v=.5;
   for(let iteration=0;iteration<8;iteration++){
    const rx=a.x+ex*u+fx*v+gx*u*v-px,ry=a.y+ey*u+fy*v+gy*u*v-py;
    const dxdu=ex+gx*v,dydu=ey+gy*v,dxdv=fx+gx*u,dydv=fy+gy*u,det=dxdu*dydv-dxdv*dydu;
    if(Math.abs(det)<1e-12)break;
    u-=(rx*dydv-ry*dxdv)/det;v-=(ry*dxdu-rx*dydu)/det;
    if(Math.abs(rx)+Math.abs(ry)<1e-9)break;
   }
   if(!Number.isFinite(u)||!Number.isFinite(v)||u< -1e-7||u>1+1e-7||v< -1e-7||v>1+1e-7)continue;
   const residual=Math.abs(a.x+ex*u+fx*v+gx*u*v-px)+Math.abs(a.y+ey*u+fy*v+gy*u*v-py);if(residual>1e-6)continue;
   u=Math.max(0,Math.min(1,u));v=Math.max(0,Math.min(1,v));
   const weights=[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v],colors=[a.color,b.color,c.color,d.color];
   const alpha=colors.reduce((sum,color,i)=>sum+color.alpha*weights[i]!,0),offset=(y*edge+x)*4;
   for(const [channel,key] of ['r','g','b'].entries())pixels[offset+channel]=alpha?Math.round(colors.reduce((sum,color,i)=>sum+color[key as 'r'|'g'|'b']*color.alpha*weights[i]!,0)/alpha):0;
   pixels[offset+3]=Math.round(alpha*255);
  }
 }
 return {width:edge,height:edge,pixels};
}
